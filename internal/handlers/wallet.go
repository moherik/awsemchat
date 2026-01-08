package handlers

import (
	"net/http"
	"strconv"

	"awsemchat/internal/models"
	"awsemchat/internal/repository"

	"github.com/labstack/echo/v4"
)

var walletRepo = repository.NewWalletRepository()

func RegisterWalletRoutes(g *echo.Group) {
	g.GET("/wallet", GetWallet)
	g.POST("/wallet/send", SendMoney)
	g.POST("/wallet/request", RequestMoney)
	g.POST("/wallet/request/:id/pay", PayRequest)
	g.GET("/wallet/request/:id", GetPaymentRequest)
}

func GetWallet(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	wallet, err := walletRepo.GetByUserID(userID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Wallet not found"})
	}
	return c.JSON(http.StatusOK, wallet)
}

type SendMoneyRequest struct {
	ReceiverID uint    `json:"receiver_id"`
	Amount     float64 `json:"amount"`
	Note       string  `json:"note"`
}

var payReqRepo = repository.NewPaymentRequestRepository()

type PaymentRequestBody struct {
	Amount float64 `json:"amount"`
	Note   string  `json:"note"`
}

func RequestMoney(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	var req PaymentRequestBody
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	if req.Amount <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Amount must be positive"})
	}

	paymentReq := &models.PaymentRequest{
		RequesterID: userID,
		Amount:      req.Amount,
		Note:        req.Note,
	}

	if err := payReqRepo.Create(paymentReq); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create request"})
	}

	// Generate deep link (mock)
	// In production: "https://awsem.chat/pay/" + id

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"id":   paymentReq.ID,
		"link": "awsemchat://pay?id=" + strconv.Itoa(int(paymentReq.ID)),
		"data": paymentReq,
	})
}

func GetPaymentRequest(c echo.Context) error {
	idParam := c.Param("id")
	id, _ := strconv.Atoi(idParam)

	req, err := payReqRepo.GetByID(uint(id))
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Request not found"})
	}
	return c.JSON(http.StatusOK, req)
}

func PayRequest(c echo.Context) error {
	userID := c.Get("user_id").(uint)
	idParam := c.Param("id")
	id, _ := strconv.Atoi(idParam)

	if err := payReqRepo.Pay(uint(id), userID); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "paid"})
}

func SendMoney(c echo.Context) error {
	senderID := c.Get("user_id").(uint)
	var req SendMoneyRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	if req.Amount <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Amount must be positive"})
	}

	if err := walletRepo.Transfer(senderID, req.ReceiverID, req.Amount, req.Note); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "success"})
}
