package repository

import (
	"time"

	"awsemchat/internal/database"
	"awsemchat/internal/models"

	"gorm.io/gorm"
)

type GroupRepository struct{}

func NewGroupRepository() *GroupRepository {
	return &GroupRepository{}
}

func (r *GroupRepository) Create(group *models.Group) error {
	return database.DB.Transaction(func(tx *gorm.DB) error {
		// Create the group
		if err := tx.Create(group).Error; err != nil {
			return err
		}

		// Add admin as first member
		member := models.GroupMember{
			GroupID:  group.ID,
			UserID:   group.AdminID,
			Role:     "admin",
			JoinedAt: time.Now(),
		}
		if err := tx.Create(&member).Error; err != nil {
			return err
		}

		return nil
	})
}

func (r *GroupRepository) AddMember(groupID, userID uint) error {
	member := models.GroupMember{
		GroupID:  groupID,
		UserID:   userID,
		JoinedAt: time.Now(),
	}
	return database.DB.Create(&member).Error
}

func (r *GroupRepository) RemoveMember(groupID, userID uint) error {
	return database.DB.Where("group_id = ? AND user_id = ?", groupID, userID).Delete(&models.GroupMember{}).Error
}

func (r *GroupRepository) GetGroupMembers(groupID uint) ([]uint, error) {
	var members []models.GroupMember
	if err := database.DB.Where("group_id = ?", groupID).Find(&members).Error; err != nil {
		return nil, err
	}

	userIDs := make([]uint, len(members))
	for i, m := range members {
		userIDs[i] = m.UserID
	}
	return userIDs, nil
}

func (r *GroupRepository) GetUserGroups(userID uint) ([]models.Group, error) {
	var members []models.GroupMember
	if err := database.DB.Where("user_id = ?", userID).Find(&members).Error; err != nil {
		return nil, err
	}

	if len(members) == 0 {
		return []models.Group{}, nil
	}

	groupIDs := make([]uint, len(members))
	for i, m := range members {
		groupIDs[i] = m.GroupID
	}

	var groups []models.Group
	if err := database.DB.Find(&groups, groupIDs).Error; err != nil {
		return nil, err
	}

	return groups, nil
}

func (r *GroupRepository) GetByID(id uint) (*models.Group, error) {
	var group models.Group
	if err := database.DB.First(&group, id).Error; err != nil {
		return nil, err
	}
	return &group, nil
}

func (r *GroupRepository) GetByInviteCode(code string) (*models.Group, error) {
	var group models.Group
	if err := database.DB.Where("invite_code = ?", code).First(&group).Error; err != nil {
		return nil, err
	}
	return &group, nil
}

func (r *GroupRepository) Update(group *models.Group) error {
	return database.DB.Save(group).Error
}

func (r *GroupRepository) GetMember(groupID, userID uint) (*models.GroupMember, error) {
	var member models.GroupMember
	if err := database.DB.Where("group_id = ? AND user_id = ?", groupID, userID).First(&member).Error; err != nil {
		return nil, err
	}
	return &member, nil
}

func (r *GroupRepository) UpdateMember(member *models.GroupMember) error {
	return database.DB.Save(member).Error
}
