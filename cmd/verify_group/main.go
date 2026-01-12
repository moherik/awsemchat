package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"time"
)

const baseURL = "http://localhost:8080/api/v1"

func main() {
	rand.Seed(time.Now().UnixNano())

	// 1. Setup Admin (User A) and Joiner (User B)
	tokenA, idA := setupUser()
	tokenB, idB := setupUser()
	log.Printf("Admin: %.0f, Joiner: %.0f", idA, idB)

	// 2. Admin Creates Group
	log.Println("--- Creating Group ---")
	group := createGroup(tokenA, "Enhanced Group")
	log.Printf("Group Created: ID=%d, Name=%s", group["id"], group["name"])
	groupID := int(group["id"].(float64))

	// 3. Admin Generates Invite Code
	log.Println("--- Generating Invite Code ---")
	code := generateInvite(tokenA, groupID)
	log.Printf("Invite Code: %s", code)

	// 4. Joiner Joins via Code
	log.Println("--- Joining via Code ---")
	joinViaCode(tokenB, code)
	log.Println("Joined successfully")

	// 5. Admin Promotes Joiner to Admin
	log.Println("--- Promoting Joiner ---")
	updateMemberRequest(tokenA, groupID, int(idB), "admin")
	log.Println("Promoted to Admin")

	// 6. Admin Kicks Joiner
	log.Println("--- Kicking Joiner ---")
	updateMemberRequest(tokenA, groupID, int(idB), "kicked")
	log.Println("Kicked Joiner")

	log.Println("ALL TESTS PASSED")
}

func createGroup(token, name string) map[string]interface{} {
	payload := map[string]string{"name": name, "description": "Test Group"}
	resp := post(token, "/groups", payload)
	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	return res
}

func generateInvite(token string, groupID int) string {
	resp := post(token, fmt.Sprintf("/groups/%d/invite", groupID), nil)
	if resp.StatusCode != 200 {
		log.Fatal("Failed to generate invite: ", resp.Status)
	}
	var res map[string]string
	json.NewDecoder(resp.Body).Decode(&res)
	return res["invite_code"]
}

func joinViaCode(token, code string) {
	payload := map[string]string{"invite_code": code}
	resp := post(token, "/groups/join", payload)
	if resp.StatusCode != 200 {
		var res map[string]string
		json.NewDecoder(resp.Body).Decode(&res)
		log.Fatal("Failed to join: ", res["error"])
	}
}

func updateMemberRequest(token string, groupID, userID int, role string) {
	payload := map[string]interface{}{"user_id": userID, "role": role}
	reqBody, _ := json.Marshal(payload)

	client := &http.Client{}
	req, _ := http.NewRequest("PUT", fmt.Sprintf("%s/groups/%d/members", baseURL, groupID), bytes.NewBuffer(reqBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		log.Fatal("Failed to update member: ", resp.Status)
	}
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
	return postJSONReturnString("/auth/otp/send", payload, "debug_code")
}
func verifyOTP(phone, code string) string {
	payload := map[string]string{"phone": phone, "code": code}
	return postJSONReturnString("/auth/otp/verify", payload, "verification_token")
}
func register(token, name, pin string) {
	payload := map[string]string{"verification_token": token, "name": name, "password": pin}
	post("", "/auth/register", payload)
}
func login(token, pin string) (string, float64) {
	payload := map[string]string{"verification_token": token, "password": pin}
	resp := post("", "/auth/login", payload)
	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	user := res["user"].(map[string]interface{})
	return res["token"].(string), user["id"].(float64)
}

func post(token, endpoint string, payload interface{}) *http.Response {
	jsonPayload, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", baseURL+endpoint, bytes.NewBuffer(jsonPayload))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	return resp
}
func postJSONReturnString(endpoint string, payload interface{}, key string) string {
	resp := post("", endpoint, payload)
	var res map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	return res[key].(string)
}
