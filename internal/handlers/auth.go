package handlers

import (
	"net/http"

	"awsemchat/internal/models"
	"awsemchat/internal/repository"
	"awsemchat/pkg/utils"

	"github.com/labstack/echo/v4"
)

var userRepo = repository.NewUserRepository()

type RegisterRequest struct {
	Phone    string `json:"phone"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type LoginRequest struct {
	Phone    string `json:"phone"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Token string       `json:"token"`
	User  *models.User `json:"user"`
}

func RegisterAuthRoutes(g *echo.Group) {
	g.POST("/register", Register)
	g.POST("/login", Login)
}

func Register(c echo.Context) error {
	var req RegisterRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	hashedPassword, err := utils.HashPIN(req.Password)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to process password"})
	}

	user := &models.User{
		Phone:    req.Phone,
		Password: hashedPassword,
		Name:     req.Name,
	}

	if err := userRepo.Create(user); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create user"})
	}

	token, err := utils.GenerateToken(user.ID, "supersecretkey") // TODO: Move to config
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}

	return c.JSON(http.StatusCreated, AuthResponse{
		Token: token,
		User:  user,
	})
}

func Login(c echo.Context) error {
	var req LoginRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	user, err := userRepo.FindByPhone(req.Phone)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid phone or password"})
	}

	if !utils.CheckPIN(req.Password, user.Password) {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid phone or password"})
	}

	token, err := utils.GenerateToken(user.ID, "supersecretkey") // TODO: Move to config
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}

	return c.JSON(http.StatusOK, AuthResponse{
		Token: token,
		User:  user,
	})
}
