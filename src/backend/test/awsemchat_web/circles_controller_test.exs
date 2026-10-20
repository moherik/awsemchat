defmodule AwsemChatWeb.CirclesControllerTest do
  @moduledoc """
  The circle routes' error codes, which are the contract the client maps to a
  screen. This file exists because the codes here were the ones most likely to
  drift: a `not_member` from a circle action is a 403, a circle that does not
  exist is a 404, and a reason nobody mapped is a 500 rather than the 400 the
  old catch-all answered.
  """

  use AwsemChatWeb.ConnCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Circles
  alias AwsemChat.Social

  setup do
    alice = create_user("+15550009001")
    bob = create_user("+15550009002")
    carol = create_user("+15550009003")

    {:ok, request} = Social.request_by_pin(alice, bob.pin)
    {:ok, _} = Social.respond(bob, request.id, :accept)
    {:ok, conversation} = Social.private_conversation(alice, bob)

    %{alice: alice, bob: bob, carol: carol, conversation: conversation}
  end

  test "GET /api/v1/circles/:id renders the profile to a member", %{alice: alice} do
    {:ok, circle} = Circles.create(alice, %{name: "Squad", description: "the team"})

    body =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/circles/#{circle.id}")
      |> json_response(200)

    assert body["circle"]["id"] == circle.id
    assert body["circle"]["type"] == "circle"
    assert body["circle"]["name"] == "Squad"
    assert body["circle"]["description"] == "the team"
    assert body["circle"]["createdBy"] == alice.id
  end

  test "GET /api/v1/circles/:id as a non-member is 403 not_member", %{
    alice: alice,
    carol: carol
  } do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    body =
      build_conn()
      |> authenticate(carol.token)
      |> get("/api/v1/circles/#{circle.id}")
      |> json_response(403)

    assert body == %{"error" => %{"code" => "not_member"}}
  end

  test "GET /api/v1/circles/:id on an unknown circle is 404 not_found", %{alice: alice} do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/circles/#{Ecto.UUID.generate()}")
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "GET /api/v1/circles/:id with a non-uuid id is 404 not_found, not a 500", %{
    alice: alice
  } do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/circles/not-a-uuid")
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "POST /api/v1/circles creates a circle", %{alice: alice} do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/circles", %{"name" => "Squad"})
      |> json_response(201)

    assert body["circle"]["name"] == "Squad"
    assert body["circle"]["type"] == "circle"
    assert body["circle"]["description"] == nil
    assert is_binary(body["circle"]["id"])
    assert is_binary(body["circle"]["createdAt"])
  end

  test "PATCH /api/v1/circles/:id on an unknown circle is 404 not_found", %{alice: alice} do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> patch("/api/v1/circles/#{Ecto.UUID.generate()}", %{"name" => "Nope"})
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "a circle action by a non-member is 403 not_member", %{
    alice: alice,
    carol: carol
  } do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    body =
      build_conn()
      |> authenticate(carol.token)
      |> post("/api/v1/circles/#{circle.id}/leave")
      |> json_response(403)

    assert body == %{"error" => %{"code" => "not_member"}}
  end

  test "a duplicate pending invite returns already_invited, not a 500", %{
    alice: alice,
    bob: bob
  } do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    # The first invite is a fresh pending row.
    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/circles/#{circle.id}/invitations", %{"userIds" => [bob.id]})
      |> json_response(200)

    assert body["results"][bob.id] == "ok"

    # The second hits the partial unique index; it must come back as a friendly
    # per-person result, not Ecto.ConstraintError.
    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/circles/#{circle.id}/invitations", %{"userIds" => [bob.id]})
      |> json_response(200)

    assert body["results"][bob.id] == "already_invited"
  end

  test "inviting someone who is not a friend reports not_friends per id", %{
    alice: alice,
    carol: carol
  } do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/circles/#{circle.id}/invitations", %{"userIds" => [carol.id]})
      |> json_response(200)

    assert body["results"][carol.id] == "not_friends"
  end

  test "accepting someone else's invitation is 404 not_found", %{
    alice: alice,
    bob: bob,
    carol: carol
  } do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    {:ok, _} = Circles.invite(alice, circle.id, [bob.id])
    invitation = fetch_invitation(circle.id, bob.id)

    body =
      build_conn()
      |> authenticate(carol.token)
      |> post("/api/v1/invitations/#{invitation.id}/accept")
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "DELETE a member as a non-member is 403", %{alice: alice, carol: carol} do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    body =
      build_conn()
      |> authenticate(carol.token)
      |> delete("/api/v1/circles/#{circle.id}/members/#{alice.id}")
      |> json_response(403)

    # The context refuses someone who is below owner/admin as `:forbidden`; a
    # non-member lands in the same branch.
    assert body == %{"error" => %{"code" => "forbidden"}}
  end

  test "every route behind Auth answers 401 unauthorized without a token" do
    for {method, path, params} <- [
          {:get, "/api/v1/circles/#{Ecto.UUID.generate()}", nil},
          {:post, "/api/v1/circles", %{"name" => "x"}},
          {:patch, "/api/v1/circles/#{Ecto.UUID.generate()}", %{"name" => "x"}},
          {:post, "/api/v1/invitations/#{Ecto.UUID.generate()}/accept", nil},
          {:post, "/api/v1/circles/#{Ecto.UUID.generate()}/leave", nil},
          {:get, "/api/v1/circles/#{Ecto.UUID.generate()}/members", nil}
        ] do
      conn = Phoenix.ConnTest.dispatch(build_conn(), AwsemChatWeb.Endpoint, method, path, params)
      assert json_response(conn, 401) == %{"error" => %{"code" => "unauthorized"}}
    end
  end

  # The success path of `GET /circles/:id/members`. This is the test that was
  # missing: the route used to hand raw `%CircleMembership{}` structs to `Jason`,
  # which cannot encode them, so a successful call was a 500 that only the 401
  # test above never saw.
  test "GET /api/v1/circles/:id/members renders the roster in camelCase", %{
    alice: alice,
    bob: bob
  } do
    {:ok, bob} = Accounts.update_profile(bob, %{"displayName" => "Bob"})
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    {:ok, _} = Circles.invite(alice, circle.id, [bob.id])
    invitation = fetch_invitation(circle.id, bob.id)
    {:ok, _} = Circles.respond(bob, invitation.id, :accept)

    body =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/circles/#{circle.id}/members")
      |> json_response(200)

    assert length(body["members"]) == 2

    owner = Enum.find(body["members"], &(&1["userId"] == alice.id))
    member = Enum.find(body["members"], &(&1["userId"] == bob.id))

    assert owner["role"] == "owner"
    assert member["role"] == "member"
    assert member["displayName"] == "Bob"

    for row <- [owner, member] do
      assert row["state"] == "active"
      assert is_binary(row["joinedAt"])

      for key <- ~w(userId displayName avatarMediaId role state joinedAt) do
        assert Map.has_key?(row, key), "member row is missing #{key}"
      end

      # The roster is not `UserJSON`: a member row must not carry the search
      # PIN, the phone, or any other member's credentials.
      refute Map.has_key?(row, "pin")
      refute Map.has_key?(row, "phone")
    end
  end

  test "the member roster is ordered by join time, oldest first", %{alice: alice, bob: bob} do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    {:ok, _} = Circles.invite(alice, circle.id, [bob.id])
    invitation = fetch_invitation(circle.id, bob.id)
    {:ok, _} = Circles.respond(bob, invitation.id, :accept)

    body =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/circles/#{circle.id}/members")
      |> json_response(200)

    assert Enum.map(body["members"], & &1["userId"]) == [alice.id, bob.id]
  end

  test "GET /api/v1/circles/:id/members as a non-member is 403 not_member", %{
    alice: alice,
    carol: carol
  } do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    body =
      build_conn()
      |> authenticate(carol.token)
      |> get("/api/v1/circles/#{circle.id}/members")
      |> json_response(403)

    assert body == %{"error" => %{"code" => "not_member"}}
  end

  test "GET /api/v1/circles/:id/members with an unknown circle is 404 not_found", %{
    alice: alice
  } do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/circles/#{Ecto.UUID.generate()}/members")
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "GET /api/v1/circles/:id/members with a non-uuid id is 404 not_found, not a 500", %{
    alice: alice
  } do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/circles/not-a-uuid/members")
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "PATCH /api/v1/circles/:id by a non-member is 403 not_member", %{
    alice: alice,
    carol: carol
  } do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    body =
      build_conn()
      |> authenticate(carol.token)
      |> patch("/api/v1/circles/#{circle.id}", %{"name" => "Hijacked"})
      |> json_response(403)

    assert body == %{"error" => %{"code" => "not_member"}}
  end

  test "PATCH /api/v1/circles/:id by an ordinary member is 403 forbidden", %{
    alice: alice,
    bob: bob
  } do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    {:ok, _} = Circles.invite(alice, circle.id, [bob.id])
    invitation = fetch_invitation(circle.id, bob.id)
    {:ok, _} = Circles.respond(bob, invitation.id, :accept)

    body =
      build_conn()
      |> authenticate(bob.token)
      |> patch("/api/v1/circles/#{circle.id}", %{"name" => "Renamed"})
      |> json_response(403)

    assert body == %{"error" => %{"code" => "forbidden"}}
  end

  test "PATCH /api/v1/circles/:id by the owner updates the profile", %{alice: alice} do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    body =
      build_conn()
      |> authenticate(alice.token)
      |> patch("/api/v1/circles/#{circle.id}", %{"name" => "Renamed", "description" => "new"})
      |> json_response(200)

    assert body["circle"]["name"] == "Renamed"
    assert body["circle"]["description"] == "new"

    # The route param `id` must not reach the changeset: it is the circle's own
    # identity, not a client-writable field.
    assert body["circle"]["id"] == circle.id
  end

  defp fetch_invitation(circle_id, invitee_id) do
    AwsemChat.Repo.get_by!(AwsemChat.Chat.CircleInvitation,
      circle_id: circle_id,
      invitee_id: invitee_id
    )
  end

  defp authenticate(conn, token) do
    put_req_header(conn, "authorization", "Bearer #{token}")
  end

  defp create_user(phone) do
    {:ok, _} = Accounts.request_code(phone)
    {:ok, %{user: user, token: token}} = Accounts.verify_code(phone, "123456")
    Map.put(user, :token, token)
  end
end
