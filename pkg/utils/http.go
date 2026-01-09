package utils

import (
	"errors"

	"github.com/labstack/echo/v4"
)

func GetUserIDFromContext(c echo.Context) (uint, error) {
	userID, ok := c.Get("user_id").(uint)
	if !ok {
		return 0, errors.New("user_id not found in context")
	}
	return userID, nil
}
