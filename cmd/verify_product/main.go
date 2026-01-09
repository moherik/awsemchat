package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"time"
)

const baseURL = "http://localhost:8080/api/v1"

func main() {
	rand.Seed(time.Now().UnixNano())

	// 1. Setup User
	token, _ := setupUser()
	log.Println("User Setup Complete")

	// 2. Create Product
	price := float64(10000 + rand.Intn(5000))
	productID := createProduct(token, "VerifyItem", price)
	log.Printf("Created Product ID: %d", productID)

	// 3. Get Product By ID
	log.Println("--- TEST: GET PRODUCT BY ID ---")
	product := getProduct(token, productID)

	if product["name"] != "VerifyItem" {
		log.Fatalf("Name mismatch: %v", product["name"])
	}
	if product["price"].(float64) != price {
		log.Fatalf("Price mismatch: %v", product["price"])
	}

	log.Printf("Verified Product: %+v", product)
	log.Println("ALL TESTS PASSED")
}

// Helpers
func setupUser() (string, float64) {
	phone := fmt.Sprintf("08%d", rand.Intn(1000000000))
	pin := "123456"

	code := sendOTP(phone)
	token := verifyOTP(phone, code)
	register(token, "User "+phone, pin)

	code2 := sendOTP(phone)
	token2 := verifyOTP(phone, code2)
	return login(token2, pin)
}

func sendOTP(phone string) string {
	payload := map[string]string{"phone": phone}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/otp/send", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	return res["debug_code"].(string)
}

func verifyOTP(phone, code string) string {
	payload := map[string]string{"phone": phone, "code": code}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/otp/verify", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	var res map[string]string
	json.NewDecoder(resp.Body).Decode(&res)
	return res["verification_token"]
}

func register(token, name, pin string) {
	payload := map[string]string{"verification_token": token, "name": name, "password": pin}
	jsonPayload, _ := json.Marshal(payload)
	http.Post(baseURL+"/auth/register", "application/json", bytes.NewBuffer(jsonPayload))
}

func login(token, pin string) (string, float64) {
	payload := map[string]string{"verification_token": token, "password": pin}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/login", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	user := res["user"].(map[string]interface{})
	return res["token"].(string), user["id"].(float64)
}

func createProduct(token, name string, price float64) uint {
	payload := map[string]interface{}{
		"name":        name,
		"description": "Test Product",
		"price":       price,
		"image_url":   "http://example.com/prod.jpg",
	}
	jsonPayload, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", baseURL+"/products", bytes.NewBuffer(jsonPayload))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 201 {
		body, _ := io.ReadAll(resp.Body)
		log.Fatalf("Create Product Failed: %s", body)
	}

	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	return uint(res["id"].(float64))
}

func getProduct(token string, id uint) map[string]interface{} {
	req, _ := http.NewRequest("GET", fmt.Sprintf("%s/products/%d", baseURL, id), nil)
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		log.Fatalf("Get Product Failed: %s", body)
	}

	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	return res
}
