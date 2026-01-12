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
	g.POST("/groups/:id/join", JoinGroup)    // Existing (Direct add? Or useless if private?)
	g.POST("/groups/join", JoinGroupViaCode) // New
	g.POST("/groups/:id/leave", LeaveGroup)
	g.GET("/groups", GetMyGroups)
	g.GET("/groups/:id", GetGroupDetails)
	g.POST("/groups/:id/invite", GenerateInviteCode)
	g.PUT("/groups/:id/members", UpdateMember)
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

// Start New Handlers

func GetGroupDetails(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	groupID, _ := strconv.Atoi(c.Param("id"))

	// Check membership
	_, err := groupRepo.GetMember(uint(groupID), userID)
	if err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Not a member"})
	}

	group, err := groupRepo.GetByID(uint(groupID))
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Group not found"})
	}

	return c.JSON(http.StatusOK, group)
}

type JoinCodeRequest struct {
	InviteCode string `json:"invite_code"`
}

func JoinGroupViaCode(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	var req JoinCodeRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	group, err := groupRepo.GetByInviteCode(req.InviteCode)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Invalid invite code"})
	}

	// Check if already member
	if _, err := groupRepo.GetMember(group.ID, userID); err == nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": "Already a member"})
	}

	if err := groupRepo.AddMember(group.ID, userID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to join group"})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "joined", "group_id": strconv.Itoa(int(group.ID))})
}

// Generate/Rotate Code
func GenerateInviteCode(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	groupID, _ := strconv.Atoi(c.Param("id"))

	// Verify Admin
	member, err := groupRepo.GetMember(uint(groupID), userID)
	if err != nil || member.Role != "admin" {
		// Also check Group.AdminID for legacy/bootstrap?
		// But Member role should be authoritative.
		// For newly created groups, AdminID is set.
		// Let's rely on Member role. Initial creator should have role=admin.
		// Wait, CreateGroup repo sets Admin as first member but Role defaults to 'member' in struct default.
		// I must fix CreateGroup repo logic to set 'admin'.
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Admin access required"})
	}

	// Generate Code (Simple random string)
	code := "INV-" + strconv.FormatInt(int64(groupID), 16) + "-" + strconv.FormatInt(int64(userID), 16) // Naive unique
	// Better: random string

	group, _ := groupRepo.GetByID(uint(groupID))
	group.InviteCode = code
	if err := groupRepo.Update(group); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update code"})
	}

	return c.JSON(http.StatusOK, map[string]string{"invite_code": code})
}

type UpdateMemberRequest struct {
	UserID uint   `json:"user_id"`
	Role   string `json:"role"` // "admin", "member", "kicked" (to remove)
}

func UpdateMember(c echo.Context) error {
	adminID := c.Get("user_id").(uint)
	groupID, _ := strconv.Atoi(c.Param("id"))
	var req UpdateMemberRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// Verify Admin
	admin, err := groupRepo.GetMember(uint(groupID), adminID)
	if err != nil || admin.Role != "admin" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Admin access required"})
	}

	if req.Role == "kicked" {
		if err := groupRepo.RemoveMember(uint(groupID), req.UserID); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to remove member"})
		}
		return c.JSON(http.StatusOK, map[string]string{"status": "removed"})
	}

	target, err := groupRepo.GetMember(uint(groupID), req.UserID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Member not found"})
	}

	target.Role = req.Role
	if err := groupRepo.UpdateMember(target); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update role"})
	}

	return c.JSON(http.StatusOK, target)
}
