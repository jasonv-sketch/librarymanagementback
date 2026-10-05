const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");

// GET dashboard statistics
router.get("/", dashboardController.getDashboardStats);

module.exports = router;
