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
	phone := fmt.Sprintf("08%d", rand.Intn(1000000000))
	pin := "123456"

	// 1. Setup User & Login
	token := setupUser(phone, pin)
	log.Printf("Token: %s...", token[:10])

	// 2. Create Products
	log.Println("--- TEST 1: CREATE PRODUCTS ---")
	p1 := createProduct(token, "Shirt", 150000)
	p2 := createProduct(token, "Pants", 250000)
	log.Printf("Product IDs: %d, %d", p1, p2)

	// 3. Create Status with Encrypted Blob (Base64)
	log.Println("--- TEST 2: CREATE STATUS WITH ENCRYPTED BLOB ---")
	// "Hello World" encrypted (simulated) -> Base64
	encryptedBlob := "SGVsbG8gV29ybGQ="
	createStatus(token, encryptedBlob, "Encrypted Status", []uint{p1, p2})

	// 4. Get Statuses
	log.Println("--- TEST 3: GET STATUSES ---")
	getStatuses(token, encryptedBlob)

	log.Println("ALL TESTS PASSED")
}

func setupUser(phone, pin string) string {
	code := sendOTP(phone)
	token := verifyOTP(phone, code)
	register(token, "Status User", pin)

	// Login to get token
	loginToken := getLoginToken(phone)
	accessToken, _ := login(loginToken, pin)
	return accessToken
}

func sendOTP(phone string) string {
	payload := map[string]string{"phone": phone}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/otp/send", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var res map[string]interface{}
	json.Unmarshal(body, &res)
	if resp.StatusCode != 200 {
		log.Fatalf("Send OTP Failed: %s", body)
	}
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

func getLoginToken(phone string) string {
	code := sendOTP(phone)
	return verifyOTP(phone, code)
}

func register(token, name, pin string) {
	payload := map[string]string{
		"verification_token": token,
		"name":               name,
		"password":           pin,
	}
	jsonPayload, _ := json.Marshal(payload)
	http.Post(baseURL+"/auth/register", "application/json", bytes.NewBuffer(jsonPayload))
}

func login(token, pin string) (string, string) {
	payload := map[string]string{
		"verification_token": token,
		"password":           pin,
	}
	jsonPayload, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL+"/auth/login", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()

	var res struct {
		Token        string `json:"token"`
		RefreshToken string `json:"refresh_token"`
	}
	json.NewDecoder(resp.Body).Decode(&res)
	return res.Token, res.RefreshToken
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

func createStatus(token, content, caption string, productIDs []uint) {
	payload := map[string]interface{}{
		"content":     content, // Base64
		"caption":     caption,
		"product_ids": productIDs,
	}
	jsonPayload, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", baseURL+"/status", bytes.NewBuffer(jsonPayload))
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
		log.Fatalf("Create Status Failed: %s", body)
	}
	log.Println("Status Created")
}

func getStatuses(token, expectedContent string) {
	req, _ := http.NewRequest("GET", baseURL+"/status", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		log.Fatalf("Get Status Failed: %s", body)
	}

	var statuses []map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&statuses); err != nil {
		log.Fatalf("Failed to decode statuses: %v", err)
	}

	log.Printf("Found %d statuses", len(statuses))
	if len(statuses) == 0 {
		log.Fatal("Expected at least 1 status")
	}

	latest := statuses[0]
	// Verify Content
	content := latest["content"].(string)
	if content != expectedContent {
		log.Fatalf("Content mismatch. Expected %s, got %s", expectedContent, content)
	}
	log.Println("Verified Content matches uploaded blob")

	// Verify Products
	if latest["products"] == nil {
		log.Fatal("Expected products list")
	}
	products := latest["products"].([]interface{})
	if len(products) != 2 {
		log.Fatalf("Expected 2 products, got %d", len(products))
	}
	log.Printf("Verified Status has %d Products", len(products))
}
