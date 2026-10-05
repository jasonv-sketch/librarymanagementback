const express = require("express");
const cors = require("cors");
require("dotenv").config();

const bookRoutes = require("./routes/bookRoutes");
const memberRoutes = require("./routes/memberRoutes");
const borrowRoutes = require("./routes/borrowRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const errorHandler = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS with support for all methods and headers
app.use(
  cors({
    origin: "*", // Adjust this to match your frontend URL in production
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Standard parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Liveness check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date() });
});

// Register API Routes
app.use("/api/books", bookRoutes);
app.use("/api/members", memberRoutes);
app.use("/api", borrowRoutes); // Maps /api/borrow, /api/return, /api/borrow-history
app.use("/api/dashboard", dashboardRoutes);

// Fallback Route for Undefined Endpoints
app.use((req, res, next) => {
  const error = new Error(`Cannot find requested route ${req.originalUrl} on this server`);
  error.statusCode = 404;
  next(error);
});

// Centralized Error Handling Middleware
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`[Server] Library Management API is running on http://localhost:${PORT}`);
  console.log(`====================================================`);
});
