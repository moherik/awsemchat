defmodule AwsemChat.AccountsTest do
  use AwsemChat.DataCase, async: false

  alias AwsemChat.Accounts
  alias AwsemChat.Accounts.PIN
  alias AwsemChat.Accounts.User

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

  test "different spellings of one number resolve to one user" do
    assert {:ok, %{user: user}} = request_and_verify("+15550000001")

    for spelling <- ["15550000001", "+1 555 000 0001", "+1-555-000-0001", "+1 (555) 000.0001"] do
      assert Accounts.get_by_phone(spelling).id == user.id,
             "#{inspect(spelling)} did not resolve to the user created from +15550000001"
    end

    assert Repo.aggregate(from(u in User, where: u.phone == "+15550000001"), :count) == 1
  end

  test "requesting a code twice under different spellings creates one account" do
    assert {:ok, _} = Accounts.request_code("+1 (555) 000 0001")
    assert {:ok, _} = Accounts.request_code("15550000001")
    assert {:ok, _} = Accounts.request_code("+1-555-000-0001")

    assert Repo.aggregate(from(u in User, where: u.phone == "+15550000001"), :count) == 1

    # None of the three spellings may survive as its own row. Scoped to the
    # spellings this test used, so an unrelated row cannot make it pass or fail.
    spellings = ["+1 (555) 000 0001", "15550000001", "+1-555-000-0001"]

    assert Repo.aggregate(from(u in User, where: u.phone in ^spellings), :count) == 0
  end

  test "normalize_phone/1 canonicalizes international spellings" do
    assert Accounts.normalize_phone("+15550000001") == "+15550000001"
    assert Accounts.normalize_phone("+1 555 000 0001") == "+15550000001"
    assert Accounts.normalize_phone("+1-555-000-0001") == "+15550000001"
    assert Accounts.normalize_phone("+1 (555) 000.0001") == "+15550000001"
    assert Accounts.normalize_phone("15550000001") == "+15550000001"
    # The seeded format: no `+` was written, so none is invented.
    assert Accounts.normalize_phone("0811110001") == "0811110001"
    assert Accounts.normalize_phone("081 111 0001") == "0811110001"
  end

  test "normalize_phone/1 reduces separators and a bare plus to an empty phone" do
    assert Accounts.normalize_phone("+") == ""
    assert Accounts.normalize_phone("+ () .-") == ""
    assert Accounts.normalize_phone("   ") == ""
  end

  test "a plus on a trunk zero is refused, not stored as a second account" do
    # `0811110001` normalizes to itself; without this guard `+0811110001` would
    # normalize to `+0811110001` and create a second account for one person.
    assert Accounts.normalize_phone("+0811110001") == ""
    assert Accounts.normalize_phone("+0 811 110 001") == ""

    assert {:error, changeset} = Accounts.request_code("+0811110001")
    refute changeset.valid?
  end

  test "a phone of separators is refused rather than stored" do
    assert {:error, changeset} = Accounts.request_code("+ () .-")
    refute changeset.valid?
    assert "can't be blank" in errors_on(changeset).phone
  end

  test "a code requested under one spelling verifies under another" do
    assert {:ok, _} = Accounts.request_code("+1 555 000 0001")

    assert {:ok, %{user: user, token: token}} = Accounts.verify_code("+15550000001", "123456")
    assert is_binary(token)
    assert Accounts.get_by_phone("15550000001").id == user.id
  end

  test "the stored phone keeps a leading plus exactly once" do
    assert {:ok, %{user: user}} = request_and_verify("+1 (555) 000.0002")
    assert user.phone == "+15550000002"
  end

  test "a phone stored without a plus is not rewritten" do
    # The seeded bots use `0811110001`; a national-format number the operator
    # chose. Normalizing it to `+0811110001` would relocate the account the seed
    # and the bot roster both address by that exact string.
    assert {:ok, _} = Accounts.request_code("0811110001")
    assert {:ok, %{user: bot}} = Accounts.verify_code("0811110001", "123456")
    assert bot.phone == "0811110001"
    assert Accounts.get_by_phone("0811110001").id == bot.id
  end

  test "PIN.generate/0 returns six uppercase alphanumeric characters" do
    assert {:ok, pin} = PIN.generate()
    assert pin =~ ~r/\A[A-Z0-9]{6}\z/
  end

  defp request_and_verify(phone) do
    assert {:ok, _} = Accounts.request_code(phone)
    Accounts.verify_code(phone, "123456")
  end
end
