defmodule AwsemChat.Accounts do
  @moduledoc """
  Accounts: users, dev OTP sign-in, auth tokens, profiles.

  Sign-in is phone + one-time code. Verifying a code issues a fresh token and
  revokes every previously issued token for that user — one active session per
  account, so logging in on a new device replaces the old one.
  """

  import Ecto.Query

  alias AwsemChat.Repo
  alias AwsemChat.Accounts.{PIN, Token, User}

  @doc """
  Requests a sign-in code for `phone`, creating the account on first use.

  The code itself is delivered by the configured `Otp` provider; only an opaque
  `requestId` travels back to the caller.
  """
  def request_code(phone) when is_binary(phone) do
    with {:ok, _user} <- find_or_create_user(phone) do
      :ok = otp_provider().request(phone)
      {:ok, %{requestId: request_id()}}
    end
  end

  @doc """
  Verifies `code` for `phone` and issues a token.

  Succeeds with `{:ok, %{token: token, user: user}}`; a fresh sign-in revokes
  every earlier token for this user. Errors: `{:error, :invalid_code}` or
  `{:error, :expired}`.
  """
  def verify_code(phone, code) when is_binary(phone) and is_binary(code) do
    case otp_provider().fetch(phone) do
      {:ok, expected} ->
        if secure_compare(expected, code) do
          issue_token_for(phone)
        else
          {:error, :invalid_code}
        end

      {:error, :expired} ->
        {:error, :expired}
    end
  end

  @doc """
  Resolves a plaintext bearer token to its user.

  Unknown and revoked tokens are indistinguishable: both are `:unauthorized`.
  """
  def authenticate(token) when is_binary(token) do
    query =
      from t in Token,
        join: u in assoc(t, :user),
        where: t.token_hash == ^Token.hash(token) and is_nil(t.revoked_at),
        preload: [user: u]

    case Repo.one(query) do
      nil ->
        {:error, :unauthorized}

      %Token{} = auth_token ->
        touch_last_used(auth_token)
        {:ok, auth_token.user}
    end
  end

  def authenticate(_token), do: {:error, :unauthorized}

  @doc "Revokes the token. Idempotent: an unknown token still returns `:ok`."
  def logout(token) when is_binary(token) do
    now = DateTime.utc_now()

    from(t in Token, where: t.token_hash == ^Token.hash(token) and is_nil(t.revoked_at))
    |> Repo.update_all(set: [revoked_at: now, updated_at: now])

    :ok
  end

  def logout(_token), do: :ok

  @doc """
  Updates profile fields: `:displayName`, `:statusText`, `:avatarMediaId`.

  `avatarMediaId` is stored without a database foreign key — the media table
  arrives in a later stage (recorded design decision).
  """
  def update_profile(%User{} = user, attrs) when is_map(attrs) do
    user
    |> User.profile_changeset(attrs)
    |> Repo.update()
  end

  @doc "Looks up a user by phone, or `nil`."
  def get_by_phone(phone) when is_binary(phone) do
    Repo.get_by(User, phone: phone)
  end

  # Two callers can race on the same phone, and a PIN can collide with a user
  # created a moment ago. Both are unique-constraint failures, so retry a
  # bounded number of times with a fresh PIN before giving up.
  defp find_or_create_user(phone, attempts \\ 3)

  defp find_or_create_user(phone, attempts) do
    case get_by_phone(phone) do
      %User{} = user ->
        {:ok, user}

      nil ->
        %{phone: phone, pin: PIN.generate()}
        |> User.create_changeset()
        |> Repo.insert()
        |> case do
          {:ok, user} -> {:ok, user}
          {:error, _changeset} when attempts > 1 -> find_or_create_user(phone, attempts - 1)
          {:error, changeset} -> {:error, changeset}
        end
    end
  end

  defp issue_token_for(phone) do
    with %User{} = user <- get_by_phone(phone) do
      token = Token.generate()

      Repo.transaction(fn ->
        revoke_all_tokens(user)
        Repo.insert!(Token.create_changeset(user, token))
      end)

      {:ok, %{token: token, user: user}}
    else
      nil -> {:error, :expired}
    end
  end

  defp revoke_all_tokens(%User{id: user_id}) do
    now = DateTime.utc_now()

    from(t in Token, where: t.user_id == ^user_id and is_nil(t.revoked_at))
    |> Repo.update_all(set: [revoked_at: now, updated_at: now])
  end

  defp touch_last_used(%Token{id: token_id}) do
    now = DateTime.utc_now()

    from(t in Token, where: t.id == ^token_id)
    |> Repo.update_all(set: [last_used_at: now])
  end

  defp otp_provider do
    Application.get_env(:awsemchat, :otp, [])
    |> Keyword.get(:provider, AwsemChat.Accounts.DevOtp)
  end

  defp request_id, do: Base.url_encode64(:crypto.strong_rand_bytes(16), padding: false)

  defp secure_compare(left, right) do
    byte_size(left) == byte_size(right) and Plug.Crypto.secure_compare(left, right)
  end
end
