"use strict";

/* Ingest endpoint for attempt records — the single write path into the
 * Attempts table. Invoked via a Lambda Function URL (no API Gateway: at this
 * traffic volume it adds cost and complexity with no benefit — see
 * ARCHITECTURE.md).
 *
 * Auth: a static shared secret, checked here, not IAM-signed requests. The
 * client is a static site with no server-side signing capability, and the
 * threat model is "keep anonymous internet scanners from writing garbage
 * into DynamoDB" — not a determined attacker. See ARCHITECTURE.md §9.
 *
 * The record shape mirrors state.js's attemptLog entries deliberately, so
 * there is no translation layer between what the browser writes locally and
 * what lands here.
 */

const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");

const client = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME;
const SHARED_SECRET = process.env.INGEST_SHARED_SECRET || "";

const REQUIRED_STRING_FIELDS = ["id", "lessonId", "mode"];

function jsonResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

exports.handler = async function (event) {
  // Lambda Function URLs always use the 2.0 payload format: event.headers
  // is a flat object with lowercase keys.
  var headers = event.headers || {};
  var provided = headers["x-attempt-secret"];
  if (!SHARED_SECRET || provided !== SHARED_SECRET) {
    return jsonResponse(401, { error: "unauthorized" });
  }

  var attempt;
  try {
    attempt = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { error: "invalid json" });
  }
  if (!attempt || typeof attempt !== "object") {
    return jsonResponse(400, { error: "invalid body" });
  }

  for (var i = 0; i < REQUIRED_STRING_FIELDS.length; i++) {
    var field = REQUIRED_STRING_FIELDS[i];
    if (typeof attempt[field] !== "string" || !attempt[field]) {
      return jsonResponse(400, { error: "missing field: " + field });
    }
  }
  if (typeof attempt.at !== "number" || !isFinite(attempt.at) || attempt.at <= 0) {
    return jsonResponse(400, { error: "missing or invalid field: at" });
  }

  // Sort key doubles as the range-query key the daily batch job needs
  // ("everything since timestamp X") and, combined with the
  // attribute_not_exists condition below, as the de-dup key for retried
  // POSTs — the same attempt id always lands on the same item.
  var sortKey = String(attempt.at) + "#" + attempt.id;

  var item = {
    pk: { S: "ATTEMPT" },
    sk: { S: sortKey },
    id: { S: attempt.id },
    lessonId: { S: attempt.lessonId },
    contentVersion: { N: String(attempt.contentVersion || 1) },
    mode: { S: attempt.mode },
    at: { N: String(attempt.at) },
    text: { S: typeof attempt.text === "string" ? attempt.text : "" },
    shownRegister: { S: typeof attempt.shownRegister === "string" ? attempt.shownRegister : "" },
    choiceIndex: { N: String(typeof attempt.choiceIndex === "number" ? attempt.choiceIndex : -1) },
    correctIndex: { N: String(typeof attempt.correctIndex === "number" ? attempt.correctIndex : -1) },
    // DynamoDB has no native tri-state boolean-or-null; store as a string
    // so "ungraded" (null) is distinguishable from "graded false".
    isCorrect: { S: attempt.isCorrect === true ? "true" : attempt.isCorrect === false ? "false" : "null" },
    receivedAt: { N: String(Date.now()) },
  };

  try {
    await client.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: "attribute_not_exists(sk)",
      })
    );
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      return jsonResponse(200, { ok: true, duplicate: true });
    }
    console.error(e);
    return jsonResponse(500, { error: "write failed" });
  }

  return jsonResponse(200, { ok: true });
};
