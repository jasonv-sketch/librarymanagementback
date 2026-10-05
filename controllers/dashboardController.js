const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../config/database");

const BOOKS_TABLE = "Books";
const MEMBERS_TABLE = "Members";
const BORROW_TABLE = "BorrowHistory";

exports.getDashboardStats = async (req, res, next) => {
  try {
    const todayStr = new Date().toISOString().split("T")[0];

    // 1. Fetch all books for calculations
    const booksData = await docClient.send(new ScanCommand({ TableName: BOOKS_TABLE }));
    const books = booksData.Items || [];

    let totalTitles = books.length;
    let totalPhysicalBooks = 0;
    let totalAvailableCopies = 0;

    books.forEach((book) => {
      totalPhysicalBooks += book.quantity || 0;
      totalAvailableCopies += book.availableCopies || 0;
    });

    const totalIssuedCopies = totalPhysicalBooks - totalAvailableCopies;

    // 2. Fetch all members
    const membersData = await docClient.send(new ScanCommand({ TableName: MEMBERS_TABLE }));
    const members = membersData.Items || [];
    const totalMembers = members.length;

    // 3. Fetch active borrow history for overdue & daily borrow counts
    const borrowData = await docClient.send(new ScanCommand({ TableName: BORROW_TABLE }));
    const borrowRecords = borrowData.Items || [];

    let overdueCount = 0;
    let borrowTodayCount = 0;

    borrowRecords.forEach((record) => {
      // Overdue books: status is 'Issued' and dueDate is earlier than today
      if (record.status === "Issued" && record.dueDate) {
        if (record.dueDate < todayStr) {
          overdueCount++;
        }
      }
      // Borrow today: issueDate matches today
      if (record.issueDate === todayStr) {
        borrowTodayCount++;
      }
    });

    res.status(200).json({
      success: true,
      data: {
        totalTitles,
        totalBooks: totalPhysicalBooks,
        availableBooks: totalAvailableCopies,
        issuedBooks: totalIssuedCopies,
        totalMembers,
        overdueBooks: overdueCount,
        borrowToday: borrowTodayCount,
      },
    });
  } catch (error) {
    next(error);
  }
};
