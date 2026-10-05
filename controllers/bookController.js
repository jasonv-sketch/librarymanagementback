const { PutCommand, GetCommand, DeleteCommand, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../config/database");
const { v4: uuidv4 } = require("uuid");

const TABLE_NAME = "Books";

// Helper to generate Book ID (e.g., BOOK-12345)
const generateBookId = () => {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BOOK-${result}`;
};

// 1. Get all books (with search, filtering, sorting, and pagination)
exports.getBooks = async (req, res, next) => {
  try {
    const { search, category, author, sortBy, sortOrder = "asc", page = 1, limit = 10 } = req.query;

    // Scan all books first (standard implementation for moderate datasets)
    const scanParams = {
      TableName: TABLE_NAME,
    };

    const data = await docClient.send(new ScanCommand(scanParams));
    let books = data.Items || [];

    // Apply client-side search (Title, Author, ISBN)
    if (search) {
      const searchLower = search.toLowerCase();
      books = books.filter(
        (book) =>
          (book.bookTitle && book.bookTitle.toLowerCase().includes(searchLower)) ||
          (book.author && book.author.toLowerCase().includes(searchLower)) ||
          (book.isbn && book.isbn.toLowerCase().includes(searchLower))
      );
    }

    // Apply category filter
    if (category) {
      books = books.filter((book) => book.category && book.category.toLowerCase() === category.toLowerCase());
    }

    // Apply author filter
    if (author) {
      books = books.filter((book) => book.author && book.author.toLowerCase() === author.toLowerCase());
    }

    // Apply sorting (by Book Title)
    if (sortBy === "bookTitle") {
      books.sort((a, b) => {
        const titleA = (a.bookTitle || "").toLowerCase();
        const titleB = (b.bookTitle || "").toLowerCase();
        if (titleA < titleB) return sortOrder === "asc" ? -1 : 1;
        if (titleA > titleB) return sortOrder === "asc" ? 1 : -1;
        return 0;
      });
    }

    // Pagination math
    const totalItems = books.length;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = pageNum * limitNum;

    const paginatedBooks = books.slice(startIndex, endIndex);

    res.status(200).json({
      success: true,
      count: paginatedBooks.length,
      totalItems,
      currentPage: pageNum,
      totalPages: Math.ceil(totalItems / limitNum),
      data: paginatedBooks,
    });
  } catch (error) {
    next(error);
  }
};

// 2. Get a single book by ID
exports.getBookById = async (req, res, next) => {
  try {
    const { bookId } = req.params;

    const params = {
      TableName: TABLE_NAME,
      Key: { bookId },
    };

    const data = await docClient.send(new GetCommand(params));

    if (!data.Item) {
      const error = new Error(`Book with ID ${bookId} not found`);
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

// 3. Create a new book
exports.createBook = async (req, res, next) => {
  try {
    const {
      bookId,
      bookTitle,
      author,
      category,
      publisher,
      isbn,
      language,
      publishedYear,
      edition,
      rackNumber,
      price,
      quantity,
      description,
    } = req.body;

    if (!bookTitle || !author || !category || !isbn) {
      const error = new Error("Title, Author, Category, and ISBN are required fields");
      error.statusCode = 400;
      return next(error);
    }

    const finalBookId = bookId ? bookId.trim() : generateBookId();
    
    // Check if bookId already exists
    const checkParams = {
      TableName: TABLE_NAME,
      Key: { bookId: finalBookId },
    };
    const checkData = await docClient.send(new GetCommand(checkParams));
    if (checkData.Item) {
      const error = new Error(`Book ID ${finalBookId} already exists. Please choose a different ID or leave it empty to auto-generate.`);
      error.statusCode = 400;
      return next(error);
    }

    const now = new Date().toISOString();
    const qty = parseInt(quantity) || 0;

    const newBook = {
      bookId: finalBookId,
      bookTitle,
      author,
      category,
      publisher: publisher || "",
      isbn,
      language: language || "English",
      publishedYear: publishedYear ? parseInt(publishedYear) : null,
      edition: edition || "1st Edition",
      rackNumber: rackNumber || "",
      price: price ? parseFloat(price) : 0,
      quantity: qty,
      availableCopies: qty, // initially copies are same as quantity
      description: description || "",
      status: qty > 0 ? "Available" : "Out of Stock",
      createdAt: now,
      updatedAt: now,
    };

    const putParams = {
      TableName: TABLE_NAME,
      Item: newBook,
    };

    await docClient.send(new PutCommand(putParams));

    res.status(201).json({
      success: true,
      message: "Book added successfully",
      data: newBook,
    });
  } catch (error) {
    next(error);
  }
};

// 4. Update an existing book
exports.updateBook = async (req, res, next) => {
  try {
    const { bookId } = req.params;
    const updateData = req.body;

    // Check if book exists
    const getParams = {
      TableName: TABLE_NAME,
      Key: { bookId },
    };
    const existingBook = await docClient.send(new GetCommand(getParams));

    if (!existingBook.Item) {
      const error = new Error(`Book with ID ${bookId} not found`);
      error.statusCode = 404;
      return next(error);
    }

    const book = existingBook.Item;
    const now = new Date().toISOString();

    // Calculate dynamic properties
    const newQty = updateData.quantity !== undefined ? parseInt(updateData.quantity) : book.quantity;
    
    // Adjust availableCopies based on the change in overall quantity
    const qtyDifference = newQty - book.quantity;
    let newAvailableCopies = (book.availableCopies || 0) + qtyDifference;
    if (newAvailableCopies < 0) {
      newAvailableCopies = 0; // sanity check
    }

    const updatedStatus = newAvailableCopies > 0 ? "Available" : "Out of Stock";

    // Build update expression for UpdateCommand
    const updateExpressionParts = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    const fieldsToUpdate = [
      "bookTitle",
      "author",
      "category",
      "publisher",
      "isbn",
      "language",
      "publishedYear",
      "edition",
      "rackNumber",
      "price",
      "description",
    ];

    fieldsToUpdate.forEach((field) => {
      if (updateData[field] !== undefined) {
        updateExpressionParts.push(`#${field} = :${field}`);
        expressionAttributeNames[`#${field}`] = field;
        expressionAttributeValues[`:${field}`] =
          field === "publishedYear"
            ? parseInt(updateData[field])
            : field === "price"
            ? parseFloat(updateData[field])
            : updateData[field];
      }
    });

    // Add calculations and timestamps
    updateExpressionParts.push("#quantity = :quantity");
    expressionAttributeNames["#quantity"] = "quantity";
    expressionAttributeValues[":quantity"] = newQty;

    updateExpressionParts.push("#availableCopies = :availableCopies");
    expressionAttributeNames["#availableCopies"] = "availableCopies";
    expressionAttributeValues[":availableCopies"] = newAvailableCopies;

    updateExpressionParts.push("#status = :status");
    expressionAttributeNames["#status"] = "status";
    expressionAttributeValues[":status"] = updatedStatus;

    updateExpressionParts.push("#updatedAt = :updatedAt");
    expressionAttributeNames["#updatedAt"] = "updatedAt";
    expressionAttributeValues[":updatedAt"] = now;

    const updateParams = {
      TableName: TABLE_NAME,
      Key: { bookId },
      UpdateExpression: `SET ${updateExpressionParts.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW",
    };

    const result = await docClient.send(new UpdateCommand(updateParams));

    res.status(200).json({
      success: true,
      message: "Book updated successfully",
      data: result.Attributes,
    });
  } catch (error) {
    next(error);
  }
};

// 5. Delete a book
exports.deleteBook = async (req, res, next) => {
  try {
    const { bookId } = req.params;

    // Check if book exists first
    const getParams = {
      TableName: TABLE_NAME,
      Key: { bookId },
    };
    const existingBook = await docClient.send(new GetCommand(getParams));

    if (!existingBook.Item) {
      const error = new Error(`Book with ID ${bookId} not found`);
      error.statusCode = 404;
      return next(error);
    }

    // Check if there are any copies currently issued
    const book = existingBook.Item;
    if (book.availableCopies < book.quantity) {
      const error = new Error(`Cannot delete book because some copies are currently issued to members.`);
      error.statusCode = 400;
      return next(error);
    }

    const deleteParams = {
      TableName: TABLE_NAME,
      Key: { bookId },
    };

    await docClient.send(new DeleteCommand(deleteParams));

    res.status(200).json({
      success: true,
      message: "Book deleted successfully",
      deletedBookId: bookId,
    });
  } catch (error) {
    next(error);
  }
};
