defmodule AwsemChat.AccountsTest do
  use AwsemChat.DataCase, async: false

  alias AwsemChat.Accounts
  alias AwsemChat.Accounts.PIN

  @phone "+15550000001"

  test "test_request_and_verify_code_returns_token" do
    assert {:ok, %{requestId: request_id}} = Accounts.request_code(@phone)
    assert is_binary(request_id)

    assert {:ok, %{token: token, user: user}} = Accounts.verify_code(@phone, "123456")
    assert is_binary(token)
    assert user.phone == @phone
    assert {:ok, authenticated} = Accounts.authenticate(token)
    assert authenticated.id == user.id
  end

  test "test_wrong_code_rejected" do
    assert {:ok, _} = Accounts.request_code(@phone)
    assert {:error, :invalid_code} = Accounts.verify_code(@phone, "000000")
  end

  test "test_expired_code_rejected" do
    assert {:ok, _} = Accounts.request_code(@phone)
    Process.sleep(1_100)
    assert {:error, :expired} = Accounts.verify_code(@phone, "123456")
  end

  test "test_new_login_revokes_previous_token" do
    assert {:ok, %{token: first_token}} = request_and_verify(@phone)

    assert {:ok, %{token: second_token}} = request_and_verify(@phone)

    refute first_token == second_token
    assert {:error, :unauthorized} = Accounts.authenticate(first_token)
    assert {:ok, authenticated} = Accounts.authenticate(second_token)
    assert is_binary(authenticated.id)
  end

  test "test_logout_revokes_token" do
    assert {:ok, %{token: token}} = request_and_verify(@phone)

    assert :ok = Accounts.logout(token)
    assert {:error, :unauthorized} = Accounts.authenticate(token)
  end

  test "test_update_profile_sets_status_and_pin_unique" do
    assert {:ok, %{user: user}} = request_and_verify(@phone)

    assert {:ok, updated} =
             Accounts.update_profile(user, %{displayName: "Ada", statusText: "hello"})

    assert updated.display_name == "Ada"
    assert updated.status_text == "hello"

    assert {:ok, %{user: other}} = request_and_verify("+15550000002")
    refute other.pin == user.pin
    assert other.pin =~ ~r/\A[A-Z0-9]{6}\z/
  end

  test "authenticate rejects unknown tokens" do
    assert {:error, :unauthorized} = Accounts.authenticate("not-a-real-token")
  end

  test "get_by_phone returns the user when present" do
    assert {:ok, %{user: user}} = request_and_verify(@phone)
    assert Accounts.get_by_phone(@phone).id == user.id
    assert Accounts.get_by_phone("+15559999999") == nil
  end

  test "PIN.generate/0 returns six uppercase alphanumeric characters" do
    assert PIN.generate() =~ ~r/\A[A-Z0-9]{6}\z/
  end

  defp request_and_verify(phone) do
    assert {:ok, _} = Accounts.request_code(phone)
    Accounts.verify_code(phone, "123456")
  end
end
