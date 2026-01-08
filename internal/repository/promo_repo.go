package repository

import (
	"awsemchat/internal/database"
	"awsemchat/internal/models"
	"time"
)

type PromotionRepository struct{}

func NewPromotionRepository() *PromotionRepository {
	return &PromotionRepository{}
}

func (r *PromotionRepository) Create(promo *models.Promotion) error {
	promo.CreatedAt = time.Now()
	if promo.ExpiresAt.IsZero() {
		promo.ExpiresAt = time.Now().Add(7 * 24 * time.Hour) // Default 7 days
	}
	return database.DB.Create(promo).Error
}

func (r *PromotionRepository) GetActive() ([]models.Promotion, error) {
	var promos []models.Promotion
	err := database.DB.Where("expires_at > ?", time.Now()).Order("created_at desc").Find(&promos).Error
	return promos, err
}
