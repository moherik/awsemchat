package handlers

import (
	"net/http"
	"strconv"

	"awsemchat/internal/models"
	"awsemchat/internal/repository"

	"github.com/labstack/echo/v4"
)

var keyRepo = repository.NewKeyRepository()

func RegisterKeyRoutes(g *echo.Group) {
	g.POST("/keys", UploadKeys)
	g.GET("/keys/prekey/:userId", GetPreKey)
}

type UploadKeysRequest struct {
	DeviceID uint             `json:"device_id"`
	Keys     []models.E2EKeys `json:"keys"`
}

func UploadKeys(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	var req UploadKeysRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// Assign UserID to all keys
	for i := range req.Keys {
		req.Keys[i].UserID = userID
		req.Keys[i].DeviceID = req.DeviceID
	}

	if err := keyRepo.UpsertKeys(req.Keys); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to upload keys"})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
}

func GetPreKey(c echo.Context) error {
	targetUserIDParam := c.Param("userId")
	targetUserID, err := strconv.Atoi(targetUserIDParam)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
	}

	key, err := keyRepo.GetOneTimePreKey(uint(targetUserID))
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "No pre-keys available"})
	}

	// In a real app, delete the key here in a transaction
	if err := keyRepo.DeleteKey(key.ID); err != nil {
		// Log error but return key? Or fail? Signal says fail if you can't guarantee one-time use.
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to claim pre-key"})
	}

	return c.JSON(http.StatusOK, key)
}
