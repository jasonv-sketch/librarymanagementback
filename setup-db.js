const { CreateTableCommand, DescribeTableCommand } = require("@aws-sdk/client-dynamodb");
const { dbClient } = require("./config/database");

async function checkTableExists(tableName) {
  try {
    await dbClient.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (err) {
    if (err.name === "ResourceNotFoundException") {
      return false;
    }
    throw err;
  }
}

async function createBooksTable() {
  const tableName = "Books";
  const exists = await checkTableExists(tableName);
  if (exists) {
    console.log(`Table "${tableName}" already exists.`);
    return;
  }

  console.log(`Creating Table "${tableName}"...`);
  const command = new CreateTableCommand({
    TableName: tableName,
    KeySchema: [
      { AttributeName: "bookId", KeyType: "HASH" }, // Partition Key
    ],
    AttributeDefinitions: [
      { AttributeName: "bookId", AttributeType: "S" },
    ],
    BillingMode: "PAY_PER_REQUEST", // On-demand billing
  });

  await dbClient.send(command);
  console.log(`Table "${tableName}" created successfully.`);
}

async function createMembersTable() {
  const tableName = "Members";
  const exists = await checkTableExists(tableName);
  if (exists) {
    console.log(`Table "${tableName}" already exists.`);
    return;
  }

  console.log(`Creating Table "${tableName}"...`);
  const command = new CreateTableCommand({
    TableName: tableName,
    KeySchema: [
      { AttributeName: "memberId", KeyType: "HASH" }, // Partition Key
    ],
    AttributeDefinitions: [
      { AttributeName: "memberId", AttributeType: "S" },
    ],
    BillingMode: "PAY_PER_REQUEST",
  });

  await dbClient.send(command);
  console.log(`Table "${tableName}" created successfully.`);
}

async function createBorrowHistoryTable() {
  const tableName = "BorrowHistory";
  const exists = await checkTableExists(tableName);
  if (exists) {
    console.log(`Table "${tableName}" already exists.`);
    return;
  }

  console.log(`Creating Table "${tableName}" with GSIs...`);
  const command = new CreateTableCommand({
    TableName: tableName,
    KeySchema: [
      { AttributeName: "borrowId", KeyType: "HASH" }, // Partition Key
    ],
    AttributeDefinitions: [
      { AttributeName: "borrowId", AttributeType: "S" },
      { AttributeName: "memberId", AttributeType: "S" },
      { AttributeName: "bookId", AttributeType: "S" },
      { AttributeName: "createdAt", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "MemberIdIndex",
        KeySchema: [
          { AttributeName: "memberId", KeyType: "HASH" }, // GSI Partition Key
          { AttributeName: "createdAt", KeyType: "RANGE" }, // GSI Sort Key
        ],
        Projection: {
          ProjectionType: "ALL",
        },
      },
      {
        IndexName: "BookIdIndex",
        KeySchema: [
          { AttributeName: "bookId", KeyType: "HASH" }, // GSI Partition Key
          { AttributeName: "createdAt", KeyType: "RANGE" }, // GSI Sort Key
        ],
        Projection: {
          ProjectionType: "ALL",
        },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  });

  await dbClient.send(command);
  console.log(`Table "${tableName}" created successfully.`);
}

async function setup() {
  try {
    console.log("Starting DynamoDB Database Setup...");
    await createBooksTable();
    await createMembersTable();
    await createBorrowHistoryTable();
    console.log("Database Setup Completed Successfully!");
  } catch (error) {
    console.error("Database setup failed:", error);
    process.exit(1);
  }
}

setup();
