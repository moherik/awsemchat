package handlers

import (
	"net/http"

	"awsemchat/internal/models"
	"awsemchat/internal/repository"

	"github.com/labstack/echo/v4"
)

var statusRepo = repository.NewStatusRepository()

func RegisterStatusRoutes(g *echo.Group) {
	g.POST("/status", CreateStatus)
	g.GET("/status", GetStatusFeed)
}

type CreateStatusRequest struct {
	ContentURL string `json:"content_url"`
	Caption    string `json:"caption"`
}

func CreateStatus(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	var req CreateStatusRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	status := &models.Status{
		UserID:     userID,
		ContentURL: req.ContentURL,
		Caption:    req.Caption,
	}

	if err := statusRepo.Create(status); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to post status"})
	}

	return c.JSON(http.StatusCreated, status)
}

func GetStatusFeed(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	_ = userID // In future, filter by contacts of userID

	statuses, err := statusRepo.GetFeed(userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load feed"})
	}

	return c.JSON(http.StatusOK, statuses)
}
