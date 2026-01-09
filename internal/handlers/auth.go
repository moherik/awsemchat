package handlers

import (
	"crypto/rand"
	"math/big"
	"net/http"
	"time"

	"awsemchat/internal/database"
	"awsemchat/internal/models"
	"awsemchat/internal/repository"
	"awsemchat/pkg/utils"

	"github.com/labstack/echo/v4"
)

var userRepo = repository.NewUserRepository()

type RegisterRequest struct {
	VerificationToken string `json:"verification_token"`
	Password          string `json:"password"`
	Name              string `json:"name"`
}

type LoginRequest struct {
	VerificationToken string `json:"verification_token"`
	Password          string `json:"password"`
}

type AuthResponse struct {
	Token        string       `json:"token"`
	RefreshToken string       `json:"refresh_token"`
	User         *models.User `json:"user"`
}

func RegisterAuthRoutes(g *echo.Group) {
	g.POST("/otp/send", SendOTP)
	g.POST("/otp/verify", VerifyOTP)
	g.POST("/register", Register)
	g.POST("/login", Login)
	g.POST("/token/refresh", RefreshToken)
}

type OTPRequest struct {
	Phone string `json:"phone"`
}

type VerifyOTPRequest struct {
	Phone string `json:"phone"`
	Code  string `json:"code"`
}

func SendOTP(c echo.Context) error {
	var req OTPRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	r, _ := rand.Int(rand.Reader, big.NewInt(900000))
	code := r.String()

	// Invalidate existing active OTPs for this phone
	database.DB.Model(&models.VerificationCode{}).Where("phone = ? AND is_active = ?", req.Phone, true).Update("is_active", false)

	otp := models.VerificationCode{
		Phone:     req.Phone,
		Code:      code,
		IsActive:  true,
		ExpiresAt: time.Now().Add(5 * time.Minute),
	}
	if err := database.DB.Create(&otp).Error; err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate OTP"})
	}

	// Mock SMS Send
	// log.Printf("SMS sent to %s: %s", req.Phone, code)

	return c.JSON(http.StatusOK, map[string]string{"message": "OTP sent", "debug_code": code})
}

func VerifyOTP(c echo.Context) error {
	var req VerifyOTPRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	var otp models.VerificationCode
	// Find Active OTP
	if err := database.DB.Where("phone = ? AND code = ? AND is_active = ?", req.Phone, req.Code, true).Order("id desc").First(&otp).Error; err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid or inactive OTP"})
	}

	if time.Now().After(otp.ExpiresAt) {
		// Mark as inactive (expired) so it can't be found next time
		otp.IsActive = false
		database.DB.Save(&otp)
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "OTP expired"})
	}

	// Generate Verification Token (Proof)
	token, err := utils.GenerateVerificationToken(req.Phone, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate proof"})
	}

	// Mark OTP as used (Inactive) - Soft Delete
	otp.IsActive = false
	database.DB.Save(&otp)

	return c.JSON(http.StatusOK, map[string]string{"verification_token": token})
}

func Register(c echo.Context) error {
	var req RegisterRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// Verify Token
	claims, err := utils.ParseVerificationToken(req.VerificationToken, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid or expired verification token"})
	}

	hashedPassword, err := utils.HashPIN(req.Password)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to process password"})
	}

	user := &models.User{
		Phone:    claims.Phone,
		Password: hashedPassword,
		Name:     req.Name,
	}

	if err := userRepo.Create(user); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create user"})
	}

	token, err := utils.GenerateAccessToken(user.ID, "supersecretkey") // TODO: Move to config
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}

	refreshToken, err := utils.GenerateRefreshToken(user.ID, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate refresh token"})
	}

	return c.JSON(http.StatusCreated, AuthResponse{
		Token:        token,
		RefreshToken: refreshToken,
		User:         user,
	})
}

func Login(c echo.Context) error {
	var req LoginRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// Verify Token
	claims, err := utils.ParseVerificationToken(req.VerificationToken, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid or expired verification token"})
	}

	user, err := userRepo.FindByPhone(claims.Phone)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid credentials"})
	}

	if !utils.CheckPIN(req.Password, user.Password) {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid phone or password"})
	}

	token, err := utils.GenerateAccessToken(user.ID, "supersecretkey") // TODO: Move to config
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}

	refreshToken, err := utils.GenerateRefreshToken(user.ID, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate refresh token"})
	}

	return c.JSON(http.StatusOK, AuthResponse{
		Token:        token,
		RefreshToken: refreshToken,
		User:         user,
	})
}

type RefreshTokenRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func RefreshToken(c echo.Context) error {
	var req RefreshTokenRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	claims, err := utils.ParseRefreshToken(req.RefreshToken, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid or expired refresh token"})
	}

	// Generate new access token
	newToken, err := utils.GenerateAccessToken(claims.UserID, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}

	// Optionally rotate refresh token here too
	// For now, just return new access token
	return c.JSON(http.StatusOK, map[string]string{
		"token": newToken,
	})
}
