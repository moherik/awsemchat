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
