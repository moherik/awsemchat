defmodule AwsemChatWeb.AuthFlowTest do
  use AwsemChatWeb.ConnCase, async: false

  alias AwsemChat.Accounts

  @phone "+15550000001"

  test "register, then GET /api/v1/me with a bearer token" do
    token = register(@phone)

    body =
      build_conn()
      |> authenticate(token)
      |> get("/api/v1/me")
      |> json_response(200)

    assert %{
             "id" => id,
             "displayName" => display_name,
             "pin" => pin,
             "statusText" => status_text,
             "avatarMediaId" => avatar_media_id
           } = body

    assert is_binary(id)
    assert display_name == nil
    assert pin =~ ~r/\A[A-Z0-9]{6}\z/
    assert status_text == nil
    assert avatar_media_id == nil
  end

  test "GET /api/v1/me without a token is 401 unauthorized" do
    body =
      build_conn()
      |> get("/api/v1/me")
      |> json_response(401)

    assert body == %{"error" => %{"code" => "unauthorized"}}
  end

  test "PATCH /api/v1/me updates the display name" do
    token = register(@phone)

    body =
      build_conn()
      |> authenticate(token)
      |> patch("/api/v1/me", %{"displayName" => "Ada"})
      |> json_response(200)

    assert body["displayName"] == "Ada"
  end

  test "POST /api/v1/auth/request_code then verify_code returns token and user" do
    assert %{"requestId" => request_id} =
             build_conn()
             |> post("/api/v1/auth/request_code", %{"phone" => @phone})
             |> json_response(200)

    assert is_binary(request_id)

    assert %{"token" => token, "user" => user} =
             build_conn()
             |> post("/api/v1/auth/verify_code", %{"phone" => @phone, "code" => "123456"})
             |> json_response(200)

    assert is_binary(token)
    assert user["phone"] == @phone
  end

  test "POST /api/v1/auth/logout revokes the token" do
    token = register(@phone)

    assert %{} =
             build_conn()
             |> authenticate(token)
             |> post("/api/v1/auth/logout")
             |> json_response(200)

    assert {:error, :unauthorized} = Accounts.authenticate(token)
  end

  defp register(phone) do
    {:ok, _} = Accounts.request_code(phone)
    {:ok, %{token: token}} = Accounts.verify_code(phone, "123456")
    token
  end

  defp authenticate(conn, token) do
    put_req_header(conn, "authorization", "Bearer #{token}")
  end
end
