package handlers

import (
	"encoding/base64"
	"net/http"

	"awsemchat/internal/database"
	"awsemchat/internal/models"
	"awsemchat/internal/repository"
	"awsemchat/pkg/utils"

	"github.com/labstack/echo/v4"
)

var statusRepo = repository.NewStatusRepository()

type CreateStatusRequest struct {
	Content    string `json:"content"` // Base64 encoded
	Caption    string `json:"caption"`
	ProductIDs []uint `json:"product_ids"`
}

func RegisterStatusRoutes(g *echo.Group) {
	g.POST("/status", CreateStatus)
	g.GET("/status", GetStatuses)
}

func CreateStatus(c echo.Context) error {
	userID, err := utils.GetUserIDFromContext(c)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	var req CreateStatusRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	var products []models.Product
	if len(req.ProductIDs) > 0 {
		database.DB.Find(&products, req.ProductIDs)
	}

	// Decode Base64 Content
	decodedContent, err := base64.StdEncoding.DecodeString(req.Content)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid content encoding"})
	}

	status := models.Status{
		UserID:   userID,
		Content:  decodedContent,
		Caption:  req.Caption,
		Products: products,
	}

	// Auto-add key for self if not present?
	// Usually sender also stores key for themselves (on other devices) or relies on local storage.
	// We'll trust the client request.

	if err := statusRepo.Create(&status); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create status"})
	}

	return c.JSON(http.StatusCreated, status)
}

func GetStatuses(c echo.Context) error {
	userID, err := utils.GetUserIDFromContext(c)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	statuses, err := statusRepo.GetActiveStatuses(userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch statuses"})
	}

	return c.JSON(http.StatusOK, statuses)
}
