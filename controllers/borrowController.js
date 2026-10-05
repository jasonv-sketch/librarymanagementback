const { PutCommand, GetCommand, ScanCommand, UpdateCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../config/database");

const BORROW_TABLE = "BorrowHistory";
const BOOKS_TABLE = "Books";
const MEMBERS_TABLE = "Members";

// Helper to generate Borrow ID (e.g. BOR-123456)
const generateBorrowId = () => {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BOR-${result}`;
};

// 1. Issue a Book
exports.issueBook = async (req, res, next) => {
  try {
    const { bookId, memberId, dueDate } = req.body;

    if (!bookId || !memberId || !dueDate) {
      const error = new Error("Book ID, Member ID, and Due Date are required");
      error.statusCode = 400;
      return next(error);
    }

    // A. Fetch and validate book existence & availability
    const bookParams = {
      TableName: BOOKS_TABLE,
      Key: { bookId },
    };
    const bookData = await docClient.send(new GetCommand(bookParams));
    if (!bookData.Item) {
      const error = new Error(`Book with ID ${bookId} does not exist`);
      error.statusCode = 404;
      return next(error);
    }
    const book = bookData.Item;

    if (book.availableCopies <= 0) {
      const error = new Error(`Book "${book.bookTitle}" is currently Out of Stock (0 copies available)`);
      error.statusCode = 400;
      return next(error);
    }

    // B. Fetch and validate member existence & status
    const memberParams = {
      TableName: MEMBERS_TABLE,
      Key: { memberId },
    };
    const memberData = await docClient.send(new GetCommand(memberParams));
    if (!memberData.Item) {
      const error = new Error(`Member with ID ${memberId} does not exist`);
      error.statusCode = 404;
      return next(error);
    }
    const member = memberData.Item;

    if (member.status !== "Active") {
      const error = new Error(`Cannot issue book. Member "${member.memberName}" profile is currently Suspended or Inactive.`);
      error.statusCode = 400;
      return next(error);
    }

    // C. Prevent duplicate borrowing of the same book by the same member (active borrow check)
    // Query MemberIdIndex GSI to find all borrow records for this member
    const queryParams = {
      TableName: BORROW_TABLE,
      IndexName: "MemberIdIndex",
      KeyConditionExpression: "memberId = :memberId",
      FilterExpression: "bookId = :bookId AND #status = :status",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":memberId": memberId,
        ":bookId": bookId,
        ":status": "Issued",
      },
    };

    const activeBorrows = await docClient.send(new QueryCommand(queryParams));
    if (activeBorrows.Items && activeBorrows.Items.length > 0) {
      const error = new Error(`Member "${member.memberName}" already has an active copy of "${book.bookTitle}" borrowed and not returned.`);
      error.statusCode = 400;
      return next(error);
    }

    // D. Generate transaction IDs & dates
    const borrowId = generateBorrowId();
    const now = new Date().toISOString();
    const todayStr = now.split("T")[0]; // YYYY-MM-DD

    const newBorrowRecord = {
      borrowId,
      bookId,
      bookTitle: book.bookTitle,
      memberId,
      memberName: member.memberName,
      issueDate: todayStr,
      dueDate: dueDate, // should be YYYY-MM-DD
      fineAmount: 0,
      status: "Issued",
      createdAt: now,
      updatedAt: now,
    };

    // E. Save transaction record to BorrowHistory
    await docClient.send(
      new PutCommand({
        TableName: BORROW_TABLE,
        Item: newBorrowRecord,
      })
    );

    // F. Atomically decrement availableCopies in Books table
    const newAvailableCopies = book.availableCopies - 1;
    const newStatus = newAvailableCopies > 0 ? "Available" : "Out of Stock";

    const updateBookParams = {
      TableName: BOOKS_TABLE,
      Key: { bookId },
      UpdateExpression: "SET availableCopies = :avail, #status = :status, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":avail": newAvailableCopies,
        ":status": newStatus,
        ":updatedAt": now,
      },
    };
    await docClient.send(new UpdateCommand(updateBookParams));

    res.status(201).json({
      success: true,
      message: "Book issued successfully",
      data: newBorrowRecord,
    });
  } catch (error) {
    next(error);
  }
};

// 2. Return a Book
exports.returnBook = async (req, res, next) => {
  try {
    const { borrowId, bookId, memberId, returnDate } = req.body;

    let borrowRecord = null;
    const now = new Date().toISOString();
    const todayStr = returnDate || now.split("T")[0]; // Use manual date or current date

    // A. Locate the borrow record
    if (borrowId) {
      // Direct lookup by borrowId
      const getParams = {
        TableName: BORROW_TABLE,
        Key: { borrowId },
      };
      const data = await docClient.send(new GetCommand(getParams));
      borrowRecord = data.Item;
    } else if (bookId && memberId) {
      // Find active borrow record by scanning/querying GSI
      const queryParams = {
        TableName: BORROW_TABLE,
        IndexName: "MemberIdIndex",
        KeyConditionExpression: "memberId = :memberId",
        FilterExpression: "bookId = :bookId AND #status = :status",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":memberId": memberId,
          ":bookId": bookId,
          ":status": "Issued",
        },
      };
      const activeBorrows = await docClient.send(new QueryCommand(queryParams));
      if (activeBorrows.Items && activeBorrows.Items.length > 0) {
        borrowRecord = activeBorrows.Items[0];
      }
    }

    if (!borrowRecord) {
      const error = new Error("Active borrowing record not found");
      error.statusCode = 404;
      return next(error);
    }

    if (borrowRecord.status === "Returned") {
      const error = new Error("This book has already been returned");
      error.statusCode = 400;
      return next(error);
    }

    // B. Calculate overdue fine ($1.00 per day overdue)
    const dueDateObj = new Date(borrowRecord.dueDate);
    const returnDateObj = new Date(todayStr);
    
    // Clear time portions for pure day comparisons
    dueDateObj.setHours(0, 0, 0, 0);
    returnDateObj.setHours(0, 0, 0, 0);

    let fineAmount = 0;
    const timeDiff = returnDateObj.getTime() - dueDateObj.getTime();
    if (timeDiff > 0) {
      const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));
      fineAmount = diffDays * 1.00; // $1 per day
    }

    // C. Update borrow record status to "Returned"
    const updateBorrowParams = {
      TableName: BORROW_TABLE,
      Key: { borrowId: borrowRecord.borrowId },
      UpdateExpression: "SET #status = :status, returnDate = :returnDate, fineAmount = :fine, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": "Returned",
        ":returnDate": todayStr,
        ":fine": fineAmount,
        ":updatedAt": now,
      },
      ReturnValues: "ALL_NEW",
    };
    const updatedBorrowData = await docClient.send(new UpdateCommand(updateBorrowParams));

    // D. Increment availableCopies in Books table
    const targetBookId = borrowRecord.bookId;
    const getBookParams = {
      TableName: BOOKS_TABLE,
      Key: { bookId: targetBookId },
    };
    const bookData = await docClient.send(new GetCommand(getBookParams));
    if (bookData.Item) {
      const book = bookData.Item;
      const newAvailableCopies = (book.availableCopies || 0) + 1;
      
      // Safety cap: availableCopies should not exceed total quantity
      const cappedCopies = newAvailableCopies > book.quantity ? book.quantity : newAvailableCopies;

      const updateBookParams = {
        TableName: BOOKS_TABLE,
        Key: { bookId: targetBookId },
        UpdateExpression: "SET availableCopies = :avail, #status = :status, updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":avail": cappedCopies,
          ":status": "Available",
          ":updatedAt": now,
        },
      };
      await docClient.send(new UpdateCommand(updateBookParams));
    }

    res.status(200).json({
      success: true,
      message: fineAmount > 0 
        ? `Book returned successfully. Late fine of $${fineAmount.toFixed(2)} applied.`
        : "Book returned successfully with zero fines.",
      data: updatedBorrowData.Attributes,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Get borrowing history (all records)
exports.getBorrowHistory = async (req, res, next) => {
  try {
    const { status, memberId, bookId, search, page = 1, limit = 10 } = req.query;

    const scanParams = {
      TableName: BORROW_TABLE,
    };

    const data = await docClient.send(new ScanCommand(scanParams));
    let history = data.Items || [];

    // Filter by status
    if (status) {
      history = history.filter((item) => item.status && item.status.toLowerCase() === status.toLowerCase());
    }

    // Filter by memberId
    if (memberId) {
      history = history.filter((item) => item.memberId && item.memberId.toLowerCase() === memberId.toLowerCase());
    }

    // Filter by bookId
    if (bookId) {
      history = history.filter((item) => item.bookId && item.bookId.toLowerCase() === bookId.toLowerCase());
    }

    // General search (Title, Member Name, Borrow ID)
    if (search) {
      const searchLower = search.toLowerCase();
      history = history.filter(
        (item) =>
          (item.bookTitle && item.bookTitle.toLowerCase().includes(searchLower)) ||
          (item.memberName && item.memberName.toLowerCase().includes(searchLower)) ||
          (item.borrowId && item.borrowId.toLowerCase().includes(searchLower))
      );
    }

    // Sort by createdAt descending (newest transaction first)
    history.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Pagination
    const totalItems = history.length;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = pageNum * limitNum;

    const paginatedHistory = history.slice(startIndex, endIndex);

    res.status(200).json({
      success: true,
      count: paginatedHistory.length,
      totalItems,
      currentPage: pageNum,
      totalPages: Math.ceil(totalItems / limitNum),
      data: paginatedHistory,
    });
  } catch (error) {
    next(error);
  }
};
