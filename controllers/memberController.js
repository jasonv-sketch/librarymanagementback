const { PutCommand, GetCommand, DeleteCommand, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../config/database");

const TABLE_NAME = "Members";
const BORROW_TABLE_NAME = "BorrowHistory";

// Helper to generate Member ID (e.g., MEM-12345)
const generateMemberId = () => {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `MEM-${result}`;
};

// 1. Get all members (with search and pagination)
exports.getMembers = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 10 } = req.query;

    const scanParams = {
      TableName: TABLE_NAME,
    };

    const data = await docClient.send(new ScanCommand(scanParams));
    let members = data.Items || [];

    // Filter by search keyword (Name, Email, Phone, Department)
    if (search) {
      const searchLower = search.toLowerCase();
      members = members.filter(
        (member) =>
          (member.memberName && member.memberName.toLowerCase().includes(searchLower)) ||
          (member.email && member.email.toLowerCase().includes(searchLower)) ||
          (member.phone && member.phone.includes(searchLower)) ||
          (member.department && member.department.toLowerCase().includes(searchLower))
      );
    }

    // Pagination
    const totalItems = members.length;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = pageNum * limitNum;

    const paginatedMembers = members.slice(startIndex, endIndex);

    res.status(200).json({
      success: true,
      count: paginatedMembers.length,
      totalItems,
      currentPage: pageNum,
      totalPages: Math.ceil(totalItems / limitNum),
      data: paginatedMembers,
    });
  } catch (error) {
    next(error);
  }
};

// 2. Get a single member by ID
exports.getMemberById = async (req, res, next) => {
  try {
    const { memberId } = req.params;

    const params = {
      TableName: TABLE_NAME,
      Key: { memberId },
    };

    const data = await docClient.send(new GetCommand(params));

    if (!data.Item) {
      const error = new Error(`Member with ID ${memberId} not found`);
      error.statusCode = 404;
      return next(error);
    }

    res.status(200).json({
      success: true,
      data: data.Item,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Create a new member
exports.createMember = async (req, res, next) => {
  try {
    const { memberId, memberName, email, phone, department, membershipType } = req.body;

    if (!memberName || !email || !phone || !membershipType) {
      const error = new Error("Name, Email, Phone, and Membership Type are required fields");
      error.statusCode = 400;
      return next(error);
    }

    const finalMemberId = memberId ? memberId.trim() : generateMemberId();

    // Check if memberId already exists
    const checkParams = {
      TableName: TABLE_NAME,
      Key: { memberId: finalMemberId },
    };
    const checkData = await docClient.send(new GetCommand(checkParams));
    if (checkData.Item) {
      const error = new Error(`Member ID ${finalMemberId} already exists. Please choose a different ID or leave it empty to auto-generate.`);
      error.statusCode = 400;
      return next(error);
    }

    const now = new Date().toISOString();
    const today = now.split("T")[0]; // YYYY-MM-DD

    const newMember = {
      memberId: finalMemberId,
      memberName,
      email,
      phone,
      department: department || "General",
      membershipType,
      joinedDate: today,
      status: "Active",
      createdAt: now,
      updatedAt: now,
    };

    const putParams = {
      TableName: TABLE_NAME,
      Item: newMember,
    };

    await docClient.send(new PutCommand(putParams));

    res.status(201).json({
      success: true,
      message: "Member registered successfully",
      data: newMember,
    });
  } catch (error) {
    next(error);
  }
};

// 4. Update an existing member
exports.updateMember = async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const updateData = req.body;

    // Check if member exists
    const getParams = {
      TableName: TABLE_NAME,
      Key: { memberId },
    };
    const existingMember = await docClient.send(new GetCommand(getParams));

    if (!existingMember.Item) {
      const error = new Error(`Member with ID ${memberId} not found`);
      error.statusCode = 404;
      return next(error);
    }

    const now = new Date().toISOString();

    // Build update parameters
    const updateExpressionParts = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    const fieldsToUpdate = [
      "memberName",
      "email",
      "phone",
      "department",
      "membershipType",
      "status",
    ];

    fieldsToUpdate.forEach((field) => {
      if (updateData[field] !== undefined) {
        updateExpressionParts.push(`#${field} = :${field}`);
        expressionAttributeNames[`#${field}`] = field;
        expressionAttributeValues[`:${field}`] = updateData[field];
      }
    });

    if (updateExpressionParts.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No changes to update",
        data: existingMember.Item,
      });
    }

    updateExpressionParts.push("#updatedAt = :updatedAt");
    expressionAttributeNames["#updatedAt"] = "updatedAt";
    expressionAttributeValues[":updatedAt"] = now;

    const updateParams = {
      TableName: TABLE_NAME,
      Key: { memberId },
      UpdateExpression: `SET ${updateExpressionParts.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW",
    };

    const result = await docClient.send(new UpdateCommand(updateParams));

    res.status(200).json({
      success: true,
      message: "Member details updated successfully",
      data: result.Attributes,
    });
  } catch (error) {
    next(error);
  }
};

// 5. Delete a member
exports.deleteMember = async (req, res, next) => {
  try {
    const { memberId } = req.params;

    // Check if member exists
    const getParams = {
      TableName: TABLE_NAME,
      Key: { memberId },
    };
    const existingMember = await docClient.send(new GetCommand(getParams));

    if (!existingMember.Item) {
      const error = new Error(`Member with ID ${memberId} not found`);
      error.statusCode = 404;
      return next(error);
    }

    // Verify if member has any outstanding unreturned books
    const borrowScanParams = {
      TableName: BORROW_TABLE_NAME,
      FilterExpression: "#memberId = :memberId AND #status = :status",
      ExpressionAttributeNames: {
        "#memberId": "memberId",
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":memberId": memberId,
        ":status": "Issued",
      },
    };

    const borrowData = await docClient.send(new ScanCommand(borrowScanParams));
    if (borrowData.Items && borrowData.Items.length > 0) {
      const error = new Error(`Cannot delete member because they currently have ${borrowData.Items.length} active borrowed book(s) outstanding.`);
      error.statusCode = 400;
      return next(error);
    }

    const deleteParams = {
      TableName: TABLE_NAME,
      Key: { memberId },
    };

    await docClient.send(new DeleteCommand(deleteParams));

    res.status(200).json({
      success: true,
      message: "Member profile deleted successfully",
      deletedMemberId: memberId,
    });
  } catch (error) {
    next(error);
  }
};
