const express = require("express");
const router = express.Router();
const bookController = require("../controllers/bookController");

// GET all books (supports query params: search, category, author, sortBy, sortOrder, page, limit)
router.get("/", bookController.getBooks);

// GET a single book by ID
router.get("/:bookId", bookController.getBookById);

// POST create a new book
router.post("/", bookController.createBook);

// PUT update an existing book by ID
router.put("/:bookId", bookController.updateBook);

// DELETE a book by ID
router.delete("/:bookId", bookController.deleteBook);

module.exports = router;
