defmodule AwsemChatWeb.MediaControllerTest do
  use AwsemChatWeb.ConnCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Media
  alias AwsemChat.Media.LocalStore
  alias AwsemChat.Repo

  @test_limit 64
  @png <<0x89, "PNG\r\n", 0x1A, "\n", 0, 0, 0, 0, 0, 0, 0, 0>>
  @pdf "%PDF-1.4"

  setup do
    isolate_media_storage(limit: @test_limit, allowed_mime: ["image/png"], store: LocalStore)

    {:ok, owner: create_user("+15550002001"), stranger: create_user("+15550002002")}
  end

  test "POST /api/v1/media stores the file and answers with the media id", %{owner: owner} do
    conn =
      build_conn()
      |> authenticate(owner.token)
      |> upload_file(@png)

    assert %{"mediaId" => media_id} = json_response(conn, 201)
    assert {:ok, _uuid} = Ecto.UUID.cast(media_id)

    media = Media.fetch!(media_id)
    assert media.owner_id == owner.id
    assert media.mime == "image/png"
    assert media.byte_size == byte_size(@png)
  end

  test "POST /api/v1/media without a token is 401" do
    conn = upload_file(build_conn(), @png)
    assert json_response(conn, 401) == %{"error" => %{"code" => "unauthorized"}}
  end

  test "POST /api/v1/media rejects an oversize file with 413", %{owner: owner} do
    oversize = :binary.copy("a", @test_limit + 1)

    conn =
      build_conn()
      |> authenticate(owner.token)
      |> upload_file(oversize)

    assert json_response(conn, 413) == %{"error" => %{"code" => "too_large"}}
    assert Repo.aggregate(Media.Media, :count) == 0
  end

  test "POST /api/v1/media rejects an unsupported content type with 415", %{owner: owner} do
    conn =
      build_conn()
      |> authenticate(owner.token)
      |> upload_file(@pdf, "application/pdf")

    assert json_response(conn, 415) == %{"error" => %{"code" => "unsupported_media_type"}}
    assert Repo.aggregate(Media.Media, :count) == 0
  end

  test "GET /api/v1/media/:id streams the original bytes to the owner", %{owner: owner} do
    media = store_media!(owner)

    conn =
      build_conn()
      |> authenticate(owner.token)
      |> get("/api/v1/media/#{media.id}")

    assert conn.status == 200
    assert IO.iodata_to_binary(conn.resp_body) == @png
    assert get_resp_header(conn, "content-type") == ["image/png"]
  end

  test "GET /api/v1/media/:id streams a file larger than one chunk intact", %{owner: owner} do
    Process.put({Media, :limit}, 10 * 1024 * 1024)

    # Bigger than the controller's 64 KB read size, so the copy really is chunked.
    big = :binary.copy(<<0xAB, 0xCD, 0xEF, 0x01>>, 40_000)
    media = store_media!(owner, big)

    conn =
      build_conn()
      |> authenticate(owner.token)
      |> get("/api/v1/media/#{media.id}")

    assert conn.status == 200
    assert IO.iodata_to_binary(conn.resp_body) == big
  end

  test "GET /api/v1/media/:id is 403 forbidden for another user", %{
    owner: owner,
    stranger: stranger
  } do
    media = store_media!(owner)

    conn =
      build_conn()
      |> authenticate(stranger.token)
      |> get("/api/v1/media/#{media.id}")

    assert json_response(conn, 403) == %{"error" => %{"code" => "forbidden"}}
  end

  test "GET /api/v1/media/:id is 401 without a token", %{owner: owner} do
    media = store_media!(owner)

    conn = get(build_conn(), "/api/v1/media/#{media.id}")

    assert json_response(conn, 401) == %{"error" => %{"code" => "unauthorized"}}
  end

  test "GET /api/v1/media/:id is 404 media_not_found for an unknown id", %{owner: owner} do
    conn =
      build_conn()
      |> authenticate(owner.token)
      |> get("/api/v1/media/#{Ecto.UUID.generate()}")

    assert json_response(conn, 404) == %{"error" => %{"code" => "media_not_found"}}
  end

  defp create_user(phone) do
    {:ok, _} = Accounts.request_code(phone)
    {:ok, %{user: user, token: token}} = Accounts.verify_code(phone, "123456")
    Map.put(user, :token, token)
  end

  defp store_media!(owner, contents \\ @png) do
    {:ok, media} = Media.upload(owner, plug_upload(contents, "image/png"))
    media
  end

  defp upload_file(conn, contents, content_type \\ "image/png") do
    conn
    |> put_req_header("content-type", "multipart/form-data")
    |> post("/api/v1/media", %{"file" => plug_upload(contents, content_type)})
  end

  defp plug_upload(contents, content_type) do
    path = Path.join(System.tmp_dir!(), "awsemchat-upload-#{System.unique_integer([:positive])}")
    File.write!(path, contents)
    on_exit(fn -> File.rm(path) end)
    %Plug.Upload{path: path, filename: "photo.png", content_type: content_type}
  end

  defp authenticate(conn, token), do: put_req_header(conn, "authorization", "Bearer #{token}")
end
