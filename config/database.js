const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
require("dotenv").config();

const region = process.env.AWS_REGION || "ap-southeast-2";

const clientConfig = {
  region: region,
};

// If local env variables for AWS credentials are explicitly provided, use them.
// Otherwise, let the AWS SDK resolve credentials from the IAM instance profile or local AWS configuration.
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  clientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
  if (process.env.AWS_SESSION_TOKEN) {
    clientConfig.credentials.sessionToken = process.env.AWS_SESSION_TOKEN;
  }
}

// Initialize the DynamoDB Client
const dbClient = new DynamoDBClient(clientConfig);

// Initialize the Document Client (for simplified JSON interaction)
const docClient = DynamoDBDocumentClient.from(dbClient, {
  marshallOptions: {
    convertEmptyValues: true, // Automatically convert empty strings/lists
    removeUndefinedValues: true, // Automatically remove undefined values
  },
});

console.log(`[DynamoDB] Configured client for region: ${region}`);

module.exports = {
  dbClient,
  docClient,
};
