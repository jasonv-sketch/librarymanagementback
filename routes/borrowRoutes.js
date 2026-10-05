const express = require("express");
const router = express.Router();
const borrowController = require("../controllers/borrowController");

// POST issue a book to a member
router.post("/borrow", borrowController.issueBook);

// POST return a borrowed book
router.post("/return", borrowController.returnBook);

// GET complete borrow history (supports query params: status, memberId, bookId, search, page, limit)
router.get("/borrow-history", borrowController.getBorrowHistory);

module.exports = router;
