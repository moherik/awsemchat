package handlers

import (
	"net/http"

	"awsemchat/internal/models"
	"awsemchat/internal/repository"

	"github.com/labstack/echo/v4"
)

var promoRepo = repository.NewPromotionRepository()

func RegisterPromoRoutes(g *echo.Group) {
	g.POST("/promotions", CreatePromotion)
	g.GET("/promotions", GetPromotions)
}

type CreatePromoRequest struct {
	Content   string `json:"content"`
	ImageURL  string `json:"image_url"`
	TargetURL string `json:"target_url"`
}

func CreatePromotion(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	var req CreatePromoRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	promo := &models.Promotion{
		CreatorID: userID,
		Content:   req.Content,
		ImageURL:  req.ImageURL,
		TargetURL: req.TargetURL,
	}

	if err := promoRepo.Create(promo); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create promotion"})
	}

	return c.JSON(http.StatusCreated, promo)
}

func GetPromotions(c echo.Context) error {
	promos, err := promoRepo.GetActive()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load promotions"})
	}
	return c.JSON(http.StatusOK, promos)
}
