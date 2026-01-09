package handlers

import (
	"net/http"
	"strconv"

	"awsemchat/internal/models"
	"awsemchat/internal/repository"

	"github.com/labstack/echo/v4"
)

var storeRepo = repository.NewStoreRepository()

func RegisterStoreRoutes(g *echo.Group) {
	g.POST("/products", CreateListing)
	g.GET("/products/:id", GetProduct)
	g.GET("/users/:id/products", GetStore)
	g.POST("/orders", BuyItem)
}

type CreateListingRequest struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Price       float64 `json:"price"`
	ImageURL    string  `json:"image_url"`
}

func CreateListing(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	var req CreateListingRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	product := &models.Product{
		SellerID:    userID,
		Name:        req.Name,
		Description: req.Description,
		Price:       req.Price,
		ImageURL:    req.ImageURL,
		IsActive:    true,
	}

	if err := storeRepo.CreateProduct(product); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create listing"})
	}

	return c.JSON(http.StatusCreated, product)
}

func GetStore(c echo.Context) error {
	targetIDParam := c.Param("id")
	targetID, err := strconv.Atoi(targetIDParam)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid User ID"})
	}

	products, err := storeRepo.GetUserProducts(uint(targetID))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch products"})
	}

	return c.JSON(http.StatusOK, products)
}

func GetProduct(c echo.Context) error {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid Product ID"})
	}

	product, err := storeRepo.GetProduct(uint(id))
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Product not found"})
	}

	return c.JSON(http.StatusOK, product)
}

type BuyItemRequest struct {
	ProductID uint `json:"product_id"`
	Quantity  int  `json:"quantity"`
}

func BuyItem(c echo.Context) error {
	buyerID := c.Get("user_id").(uint)
	var req BuyItemRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	if req.Quantity <= 0 {
		req.Quantity = 1
	}

	order, err := storeRepo.Purchase(buyerID, req.ProductID, req.Quantity)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, order)
}
