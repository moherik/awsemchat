package middleware

import (
	"net/http"
	"strings"

	"awsemchat/pkg/utils"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
)

func AuthMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		authHeader := c.Request().Header.Get("Authorization")
		if authHeader == "" {
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Missing authorization header"})
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		token, err := jwt.ParseWithClaims(tokenString, &utils.Claims{}, func(token *jwt.Token) (interface{}, error) {
			return []byte("supersecretkey"), nil // TODO: Use config
		})

		if err != nil || !token.Valid {
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid or expired token"})
		}

		claims, ok := token.Claims.(*utils.Claims)
		if !ok {
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token claims"})
		}

		c.Set("user_id", claims.UserID)
		return next(c)
	}
}
