package main

import (
	"log"

	"awsemchat/internal/config"
	"awsemchat/internal/database"
	"awsemchat/internal/handlers"
	authMiddleware "awsemchat/internal/middleware"
	"awsemchat/internal/websocket"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

func main() {
	// Load Configuration
	cfg := config.LoadConfig()

	// Connect to Database
	database.Connect(cfg.DatabaseURL)
	database.Migrate()

	// Initialize WebSocket Hub
	hub := websocket.NewHub()
	handlers.Hub = hub
	go hub.Run()

	// Initialize Echo
	e := echo.New()

	// Middleware
	e.Use(middleware.RequestLogger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORS())

	// Routes
	v1 := e.Group("/api/v1")

	// Health Check
	v1.GET("/health", func(c echo.Context) error {
		return c.JSON(200, map[string]string{"status": "ok"})
	})

	// Auth Routes
	authGroup := v1.Group("/auth")
	handlers.RegisterAuthRoutes(authGroup)

	// Protected Routes
	protected := v1.Group("")
	protected.Use(authMiddleware.AuthMiddleware)
	handlers.RegisterUserRoutes(protected)
	handlers.RegisterKeyRoutes(protected)
	handlers.RegisterGroupRoutes(protected)
	handlers.RegisterWalletRoutes(protected)
	handlers.RegisterStoreRoutes(protected)
	handlers.RegisterStatusRoutes(protected)
	handlers.RegisterPromoRoutes(protected)
	protected.GET("/ws", handlers.ServeWS)

	// Start Server
	log.Println("Server starting on port " + cfg.Port)
	e.Logger.Fatal(e.Start(":" + cfg.Port))
}
