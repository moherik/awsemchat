package handlers

import (
	"crypto/rand"
	"log"
	"math/big"
	"net/http"
	"time"

	"awsemchat/internal/database"
	"awsemchat/internal/models"
	"awsemchat/internal/repository"
	"awsemchat/pkg/utils"

	authMiddleware "awsemchat/internal/middleware"
	"awsemchat/internal/websocket"

	"github.com/labstack/echo/v4"
)

// upgrader is defined in chat.go (same package)

var userRepo = repository.NewUserRepository()

type RegisterRequest struct {
	VerificationToken string `json:"verification_token"`
	Password          string `json:"password"`
	Name              string `json:"name"`
	DeviceUUID        string `json:"device_uuid"`
	DeviceName        string `json:"device_name"`
}

type LoginRequest struct {
	VerificationToken string `json:"verification_token"`
	Password          string `json:"password"`
	DeviceUUID        string `json:"device_uuid"`
	DeviceName        string `json:"device_name"`
}

type AuthResponse struct {
	Token        string       `json:"token"`
	RefreshToken string       `json:"refresh_token"`
	User         *models.User `json:"user"`
	DeviceID     uint         `json:"device_id"`
}

func RegisterAuthRoutes(g *echo.Group) {
	g.POST("/otp/send", SendOTP)
	g.POST("/otp/verify", VerifyOTP)
	g.POST("/register", Register)
	g.POST("/login", Login)
	g.POST("/token/refresh", RefreshToken)
	g.GET("/ws", ServeAuthWS)                                          // Unauthenticated WS for QR
	g.POST("/devices/link", LinkDevice, authMiddleware.AuthMiddleware) // Linking action (requires existing auth)
}

func ServeAuthWS(c echo.Context) error {
	log.Println("ServeAuthWS: Hit")
	w := c.Response().Writer
	r := c.Request()

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ServeAuthWS Upgrade Error: %v", err)
		return err
	}
	log.Println("ServeAuthWS: Upgraded")

	code := websocket.GlobalLinkManager.NewSession(conn)

	// Send Code to Client
	conn.WriteJSON(map[string]string{
		"type": "qr_code",
		"code": code,
	})

	return nil
}

type LinkDeviceRequest struct {
	Code       string `json:"code"`
	DeviceName string `json:"device_name"` // Name for the NEW device
}

func LinkDevice(c echo.Context) error {
	var req LinkDeviceRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	userID := c.Get("user_id").(uint)

	// Create Device Record for the NEW device
	// The secondary device generates a UUID? Or the Server generates one?
	// Usually Secondary Device sends its UUID or we generate one.
	// Let's generate a random UUID for the secondary device here if not provided?
	// Actually, `getOrCreateDevice` expects a UUID.
	// For web linking, usually the browser has a generated UUID in local storage.
	// But `LinkDevice` request comes from PHONE. Phone doesn't know Browser's UUID unless encoded in QR.
	// Ah! The QR Code usually encodes a Session ID.
	// To fully support persistent Web ID, the Web Client should send its Device UUID upon connection to `/auth/ws`?
	// Or we just generate a new one for this session.
	// Let's assume for this Phase, we generate a new Device ID for the linked session.

	newDeviceUUID := "linked-" + req.Code // Simple derivation or random
	deviceName := req.DeviceName
	if deviceName == "" {
		deviceName = "Linked Device"
	}

	device, err := getOrCreateDevice(userID, newDeviceUUID, deviceName)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create linked device"})
	}

	// Generate Tokens
	token, err := utils.GenerateAccessToken(userID, device.ID, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Token generation failed"})
	}
	refreshToken, err := utils.GenerateRefreshToken(userID, device.ID, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Refresh Token generation failed"})
	}

	// Fetch User Info to send
	user, err := userRepo.FindByID(userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "User not found"})
	}

	payload := AuthResponse{
		Token:        token,
		RefreshToken: refreshToken,
		User:         user,
		DeviceID:     device.ID,
	}

	// Push to Web Socket
	if success := websocket.GlobalLinkManager.AuthorizeSession(req.Code, payload); !success {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Link code invalid or expired"})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "Device linked successfully"})
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

func getOrCreateDevice(userID uint, deviceUUID, deviceName string) (*models.Device, error) {
	if deviceUUID == "" {
		// Fallback or Error? Allow empty for backward compatibility?
		// Let's generate one if empty? Or assume "default".
		deviceUUID = "default"
		deviceName = "Unknown Device"
	}

	var device models.Device
	err := database.DB.Where("user_id = ? AND device_uuid = ?", userID, deviceUUID).First(&device).Error
	if err != nil {
		// Create
		device = models.Device{
			UserID:     userID,
			DeviceUUID: deviceUUID,
			Name:       deviceName,
			LastSeen:   time.Now(),
		}
		if createErr := database.DB.Create(&device).Error; createErr != nil {
			return nil, createErr
		}
	} else {
		// Update Name/LastSeen
		device.Name = deviceName
		device.LastSeen = time.Now()
		database.DB.Save(&device)
	}
	return &device, nil
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

	device, err := getOrCreateDevice(user.ID, req.DeviceUUID, req.DeviceName)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to register device"})
	}

	token, err := utils.GenerateAccessToken(user.ID, device.ID, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}

	refreshToken, err := utils.GenerateRefreshToken(user.ID, device.ID, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate refresh token"})
	}

	return c.JSON(http.StatusCreated, AuthResponse{
		Token:        token,
		RefreshToken: refreshToken,
		User:         user,
		DeviceID:     device.ID,
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

	device, err := getOrCreateDevice(user.ID, req.DeviceUUID, req.DeviceName)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to register device"})
	}

	token, err := utils.GenerateAccessToken(user.ID, device.ID, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}

	refreshToken, err := utils.GenerateRefreshToken(user.ID, device.ID, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate refresh token"})
	}

	return c.JSON(http.StatusOK, AuthResponse{
		Token:        token,
		RefreshToken: refreshToken,
		User:         user,
		DeviceID:     device.ID,
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
	newToken, err := utils.GenerateAccessToken(claims.UserID, claims.DeviceID, "supersecretkey")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"token": newToken,
	})
}
