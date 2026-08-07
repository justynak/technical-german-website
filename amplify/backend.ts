import { defineBackend } from "@aws-amplify/backend";
import { CfnOutput, RemovalPolicy } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";

/* No Amplify "categories" (auth/data/storage) are defined — this app has a
 * single user and doesn't need Cognito or AppSync/GraphQL. Everything below
 * is plain CDK, added via backend.createStack(), which is Amplify Gen 2's
 * documented escape hatch for custom AWS resources. This keeps the frontend
 * a dependency-free static site: it talks to the Lambda Function URL with a
 * plain fetch(), never through the aws-amplify client library.
 */
const backend = defineBackend({});

const stack = backend.createStack("AttemptsStack");

/* Single-table design: pk is a constant ("ATTEMPT"), sk is "<at>#<id>" so a
 * Query (not a Scan) can answer "everything since timestamp X" — the access
 * pattern the future daily analysis job needs. See ARCHITECTURE.md §4/§12.
 *
 * RemovalPolicy.RETAIN: this holds a real person's practice history. If the
 * stack is ever torn down (e.g. deleting a sandbox or branch), the table
 * should survive that by default, not be silently deleted with it.
 */
const attemptsTable = new dynamodb.Table(stack, "AttemptsTable", {
  partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.RETAIN,
});

/* The shared secret is read from an Amplify branch environment variable at
 * build time (App settings -> Environment variables in the Amplify console),
 * not committed to source control. See README.md for the one-time setup. */
const ingestSecret = process.env.INGEST_SHARED_SECRET ?? "";

const recordAttemptFn = new lambda.Function(stack, "RecordAttemptFunction", {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset("amplify/functions/record-attempt"),
  environment: {
    TABLE_NAME: attemptsTable.tableName,
    INGEST_SHARED_SECRET: ingestSecret,
  },
});

attemptsTable.grantWriteData(recordAttemptFn);

/* AuthType.NONE + the shared-secret header check inside the function, not
 * IAM-signed requests: the client is a static site with no request-signing
 * capability. CORS is wide open for now because the exact Amplify hosting
 * origin isn't known until after the first deploy — tighten allowedOrigins
 * to that origin once it exists (see README.md "next step"). */
const fnUrl = recordAttemptFn.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ["*"],
    allowedMethods: [lambda.HttpMethod.POST],
    allowedHeaders: ["content-type", "x-attempt-secret"],
  },
});

new CfnOutput(stack, "RecordAttemptFunctionUrl", {
  value: fnUrl.url,
});
