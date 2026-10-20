defmodule AwsemChat.Accounts do
  @moduledoc """
  Accounts: users, dev OTP sign-in, auth tokens, profiles.

  Sign-in is phone + one-time code. Verifying a code issues a fresh token and
  revokes every previously issued token for that user — one active session per
  account, so logging in on a new device replaces the old one.

  ## Phone normalization

  The phone is the account identity, so the same number written two ways has to
  be one account. `request_code/1`, `verify_code/2` and `get_by_phone/1` all run
  the input through `normalize_phone/1` and then the OTP store, so a code
  requested as `+1 555 000 0001` verifies as `+15550000001`.

  The rules, in order:

  - A number with a leading `+` is international: the `+` stays and everything
    that is whitespace or one of `-` `(` `)` `.` is dropped. `+1 (555) 000.0001`
    becomes `+15550000001`.
  - A number with no `+` gets the same separator strip, then a leading `+` —
    unless it starts with `0`, the national trunk marker the seeded bots use.
    `0811110001` stays `0811110001`, because the seed and the bot roster address
    that account by that exact string and a `+` would invent a country code
    nobody wrote. `15550000001` becomes `+15550000001`, the same account as
    `+15550000001`.
  - A phone of pure separators normalizes to `""`, which the changeset refuses
    exactly as before.
  """

  import Ecto.Query

  alias AwsemChat.Repo
  alias AwsemChat.Accounts.{PIN, Token, User}

  @doc """
  Requests a sign-in code for `phone`, creating the account on first use.

  `phone` is normalized first (`normalize_phone/1`), so every spelling of one
  number reaches the same account and the same OTP slot. The code itself is
  delivered by the configured `Otp` provider; only an opaque `requestId` travels
  back to the caller.
  """
  def request_code(phone) when is_binary(phone) do
    phone = normalize_phone(phone)

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
    phone = normalize_phone(phone)

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

  @doc "Looks up a user by phone, or `nil`. The phone is normalized first."
  def get_by_phone(phone) when is_binary(phone) do
    Repo.get_by(User, phone: normalize_phone(phone))
  end

  @doc "Looks up a user by id, or `nil`. An unparseable id is simply not found."
  def get_by_id(user_id) when is_binary(user_id) do
    case Ecto.UUID.cast(user_id) do
      {:ok, uuid} -> Repo.get(User, uuid)
      :error -> nil
    end
  end

  def get_by_id(_user_id), do: nil

  # Two callers can race on the same phone, and a PIN can collide with a user
  # created a moment ago. Both are unique-constraint failures, so retry a
  # bounded number of times with a fresh PIN before giving up.
  defp find_or_create_user(phone, attempts \\ 3)

  defp find_or_create_user(phone, attempts) do
    case get_by_phone(phone) do
      %User{} = user ->
        {:ok, user}

      nil ->
        case PIN.generate() do
          # The pool has nothing left. Retrying would draw from the same empty
          # pool, so this is reported as-is and the sign-in endpoint answers
          # `internal_error` rather than a stack trace.
          {:error, :pin_exhausted} ->
            {:error, :pin_exhausted}

          {:ok, pin} ->
            insert_user(phone, pin, attempts)
        end
    end
  end

  defp insert_user(phone, pin, attempts) do
    %{phone: phone, pin: pin}
    |> User.create_changeset()
    |> Repo.insert()
    |> case do
      {:ok, user} -> {:ok, user}
      {:error, _changeset} when attempts > 1 -> find_or_create_user(phone, attempts - 1)
      {:error, changeset} -> {:error, changeset}
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

  @doc """
  The identity a phone string is stored and looked up under.

  `+15550000001`, `15550000001` and `+1 555 000 0001` all normalize to
  `+15550000001`. Separators (`\\s` `-` `(` `)` `.`) are dropped, and the result
  is given the canonical leading `+` unless it starts with `0`.

  A leading `0` is the national trunk marker the seeded bots use: their numbers
  are stored as `0811110001`, the seed and the bot roster address them by that
  exact string, and prefixing a `+` would invent a country code nobody wrote.
  `0811110001` therefore stays `0811110001`; every other input gets the `+`.

  The tradeoff is a bare national number with no trunk `0` and no country code
  (a US `4155550000`, say) is read as international: it becomes
  `+4155550000`, not `+14155550000`. The app never asks a user for a number in
  that shape, so this is accepted rather than guessed at, and adding real
  country-code resolution is deferred with the SMS provider.
  """
  def normalize_phone(phone) when is_binary(phone) do
    digits = String.replace(phone, ~r/[\s\-().]/, "")

    case digits do
      # Separators with nothing else: `()`, `- .` or a bare `+`. All of them are
      # an empty phone, not a phone whose identity is `+`.
      "+" -> ""
      "" -> ""
      "0" <> _trunk -> digits
      "+" <> _country -> digits
      _international -> "+" <> digits
    end
  end

  defp request_id, do: Base.url_encode64(:crypto.strong_rand_bytes(16), padding: false)

  defp secure_compare(left, right) do
    byte_size(left) == byte_size(right) and Plug.Crypto.secure_compare(left, right)
  end
end
