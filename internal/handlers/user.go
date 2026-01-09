package handlers

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

func RegisterUserRoutes(g *echo.Group) {
	g.GET("/profile", GetProfile)
	g.PUT("/profile", UpdateProfile)
	g.PUT("/profile/fcm", UpdateFCMToken)
	g.POST("/users/block", BlockUser)
	g.POST("/users/unblock", UnblockUser)
	g.GET("/users/:pin", GetUserByPIN)
}

func GetProfile(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	user, err := userRepo.FindByID(userID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}
	return c.JSON(http.StatusOK, user)
}

type UpdateProfileRequest struct {
	Name      string `json:"name"`
	Bio       string `json:"bio"`
	AvatarURL string `json:"avatar_url"`
}

func UpdateProfile(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	var req UpdateProfileRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	user, err := userRepo.FindByID(userID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}

	if req.Name != "" {
		user.Name = req.Name
	}
	if req.Bio != "" {
		user.Bio = req.Bio
	}
	if req.AvatarURL != "" {
		user.AvatarURL = req.AvatarURL
	}

	if err := userRepo.Update(user); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update profile"})
	}

	return c.JSON(http.StatusOK, user)
}

type FCMRequest struct {
	Token string `json:"token"`
}

func UpdateFCMToken(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	var req FCMRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	user, err := userRepo.FindByID(userID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}

	user.FCMToken = req.Token
	if err := userRepo.Update(user); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update FCM token"})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "FCM Token updated"})
}

type BlockRequest struct {
	UserID uint `json:"user_id"`
}

func BlockUser(c echo.Context) error {
	blockerID := c.Get("user_id").(uint)
	var req BlockRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	if err := userRepo.BlockUser(blockerID, req.UserID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to block user"})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "User blocked"})
}

func UnblockUser(c echo.Context) error {
	blockerID := c.Get("user_id").(uint)
	var req BlockRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	if err := userRepo.UnblockUser(blockerID, req.UserID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to unblock user"})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "User unblocked"})
}

func GetUserByPIN(c echo.Context) error {
	pin := c.Param("pin")
	user, err := userRepo.FindByPIN(pin)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}

	// Check Online Status
	isOnline := false
	if Hub != nil {
		isOnline = Hub.IsUserOnline(user.ID)
	}

	// Return limited public info
	publicProfile := map[string]interface{}{
		"id":         user.ID,
		"pin":        user.PIN,
		"phone":      user.Phone,
		"name":       user.Name,
		"avatar_url": user.AvatarURL,
		"public_key": user.PublicKey,
		"bio":        user.Bio,
		"last_seen":  user.LastSeen,
		"is_online":  isOnline,
	}

	return c.JSON(http.StatusOK, publicProfile)
}
