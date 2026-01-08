package handlers

import (
	"net/http"
	"strconv"

	"awsemchat/internal/models"
	"awsemchat/internal/repository"

	"github.com/labstack/echo/v4"
)

var groupRepo = repository.NewGroupRepository()

func RegisterGroupRoutes(g *echo.Group) {
	g.POST("/groups", CreateGroup)
	g.POST("/groups/:id/join", JoinGroup)
	g.POST("/groups/:id/leave", LeaveGroup)
	g.GET("/groups", GetMyGroups)
}

type CreateGroupRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func CreateGroup(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	var req CreateGroupRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	group := &models.Group{
		Name:        req.Name,
		Description: req.Description,
		AdminID:     userID,
	}

	if err := groupRepo.Create(group); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create group"})
	}

	return c.JSON(http.StatusCreated, group)
}

func JoinGroup(c echo.Context) error {
	currentUser := c.Get("user_id").(uint)
	groupIDParam := c.Param("id")

	groupID, err := strconv.Atoi(groupIDParam)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid group ID"})
	}

	if err := groupRepo.AddMember(uint(groupID), currentUser); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to join group"})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "joined"})
}

func LeaveGroup(c echo.Context) error {
	currentUser := c.Get("user_id").(uint)
	groupIDParam := c.Param("id")

	groupID, err := strconv.Atoi(groupIDParam)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid group ID"})
	}

	if err := groupRepo.RemoveMember(uint(groupID), currentUser); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to leave group"})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "left"})
}

func GetMyGroups(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	groups, err := groupRepo.GetUserGroups(userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch groups"})
	}
	return c.JSON(http.StatusOK, groups)
}
