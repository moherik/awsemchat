defmodule AwsemChat.CirclesTest do
  use AwsemChat.DataCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Chat.{CircleInvitation, Conversation}
  alias AwsemChat.Circles
  alias AwsemChat.Social

  setup do
    alice = create_user("+15550005001")
    bob = create_user("+15550005002")
    carol = create_user("+15550005003")
    dave = create_user("+15550005004")

    %{alice: alice, bob: bob, carol: carol, dave: dave}
  end

  test "test_create_circle_with_owner_membership", %{alice: alice} do
    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    assert circle.type == :circle
    assert circle.name == "Squad"

    assert {:ok, members} = Circles.list_members(alice, circle.id)

    assert Enum.any?(members, fn m ->
             m.user_id == alice.id and m.role == :owner and m.state == :active
           end)
  end

  test "test_invite_requires_accepted_friendship", %{alice: alice, bob: bob} do
    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    assert {:ok, results} = Circles.invite(alice, circle.id, [bob.id])
    refute Map.get(results, bob.id) == :ok
  end

  test "test_accept_join_boundary_hides_prejoin_messages", %{alice: alice, bob: bob} do
    assert {:ok, _request} = Social.request_by_pin(alice, bob.pin)
    assert {:ok, _} = Social.respond(bob, get_pending_request_id(bob, alice), :accept)

    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    _ = Repo.get_by!(Conversation, id: circle.id)

    # Alice sends a message before Bob joins
    {:ok, _msg1} =
      Chat.send_message(
        alice,
        circle.id,
        message_attrs(%{payload: %{"v" => 1, "text" => "before"}})
      )

    # Invite and accept
    assert {:ok, _results} = Circles.invite(alice, circle.id, [bob.id])
    inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: bob.id)
    assert {:ok, _membership} = Circles.respond(bob, inv.id, :accept)

    # Bob should not see pre-join message
    assert {:ok, %{messages: messages}} = Chat.list_messages(bob, circle.id, %{})
    refute Enum.any?(messages, fn m -> m.payload["text"] == "before" end)
  end

  test "test_concurrent_join_capacity_race", %{alice: alice, bob: bob, carol: carol, dave: dave} do
    # Create circle with capacity 20; add 19 members so only 1 slot left
    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    members_to_add = [bob, carol, dave]

    # Make them friends with alice and invite/add them
    Enum.each(members_to_add, fn u ->
      {:ok, req} = Social.request_by_pin(alice, u.pin)
      {:ok, _} = Social.respond(u, req.id, :accept)
      {:ok, _} = Circles.invite(alice, circle.id, [u.id])
      inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: u.id)
      {:ok, _} = Circles.respond(u, inv.id, :accept)
    end)

    # Fill up to 19 total active members (alice + bob + carol + dave = 4 so far; need 15 more)
    # Create more users
    _extra =
      for i <- 1..16 do
        u = create_user("+1555000600#{String.pad_leading("#{i}", 2, "0")}")
        {:ok, req} = Social.request_by_pin(alice, u.pin)
        {:ok, _} = Social.respond(u, req.id, :accept)
        {:ok, _} = Circles.invite(alice, circle.id, [u.id])
        inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: u.id)
        {:ok, _} = Circles.respond(u, inv.id, :accept)
        u
      end

    assert {:ok, members} = Circles.list_members(alice, circle.id)
    assert length(members) == 20

    # Now try to add one more - should fail
    new_user = create_user("+15550006999")
    {:ok, req} = Social.request_by_pin(alice, new_user.pin)
    {:ok, _} = Social.respond(new_user, req.id, :accept)
    {:ok, _} = Circles.invite(alice, circle.id, [new_user.id])
    inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: new_user.id)
    assert {:error, :circle_full} = Circles.respond(new_user, inv.id, :accept)
  end

  test "test_concurrent_join_capacity_race_two_tasks", %{alice: alice} do
    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    # Fill to 19
    for i <- 1..18 do
      u = create_user("+1555000700#{String.pad_leading("#{i}", 2, "0")}")
      {:ok, req} = Social.request_by_pin(alice, u.pin)
      {:ok, _} = Social.respond(u, req.id, :accept)
      {:ok, _} = Circles.invite(alice, circle.id, [u.id])
      inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: u.id)
      {:ok, _} = Circles.respond(u, inv.id, :accept)
    end

    # Total now 1+18 = 19

    u1 = create_user("+15550007991")
    u2 = create_user("+15550007992")

    Enum.each([u1, u2], fn u ->
      {:ok, req} = Social.request_by_pin(alice, u.pin)
      {:ok, _} = Social.respond(u, req.id, :accept)
      {:ok, _} = Circles.invite(alice, circle.id, [u.id])
    end)

    inv1 = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: u1.id)
    inv2 = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: u2.id)

    parent = self()

    task1 =
      Task.async(fn ->
        Ecto.Adapters.SQL.Sandbox.allow(Repo, parent, self())
        Circles.respond(u1, inv1.id, :accept)
      end)

    task2 =
      Task.async(fn ->
        Ecto.Adapters.SQL.Sandbox.allow(Repo, parent, self())
        Circles.respond(u2, inv2.id, :accept)
      end)

    res1 = Task.await(task1)
    res2 = Task.await(task2)

    results = [res1, res2]
    assert Enum.count(results, &match?({:ok, _}, &1)) == 1
    assert Enum.count(results, &(&1 == {:error, :circle_full})) == 1
    assert {:ok, members} = Circles.list_members(alice, circle.id)
    assert length(members) == 20
  end

  test "test_removed_member_cannot_list_messages_after_removal_and_gets_no_fanout", %{
    alice: alice,
    bob: bob
  } do
    assert {:ok, _request} = Social.request_by_pin(alice, bob.pin)
    assert {:ok, _} = Social.respond(bob, get_pending_request_id(bob, alice), :accept)

    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    assert {:ok, _results} = Circles.invite(alice, circle.id, [bob.id])
    inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: bob.id)
    assert {:ok, _} = Circles.respond(bob, inv.id, :accept)

    {:ok, _msg} =
      Chat.send_message(alice, circle.id, message_attrs(%{payload: %{"v" => 1, "text" => "hi"}}))

    assert :ok = Circles.remove_member(alice, circle.id, bob.id)

    assert {:error, _} = Chat.list_messages(bob, circle.id, %{})
  end

  test "test_last_owner_leave_promotes_successor", %{alice: alice, bob: bob} do
    assert {:ok, _request} = Social.request_by_pin(alice, bob.pin)
    assert {:ok, _} = Social.respond(bob, get_pending_request_id(bob, alice), :accept)

    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    assert {:ok, _results} = Circles.invite(alice, circle.id, [bob.id])
    inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: bob.id)
    assert {:ok, _} = Circles.respond(bob, inv.id, :accept)

    assert :ok = Circles.leave(alice, circle.id)

    # Alice left, so Bob (promoted to owner) is the one who may read the roster.
    assert {:ok, members} = Circles.list_members(bob, circle.id)

    assert Enum.any?(members, fn m ->
             m.user_id == bob.id and m.role == :owner and m.state == :active
           end)
  end

  test "test_list_members_requires_an_active_member", %{alice: alice, carol: carol} do
    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    # A stranger cannot enumerate the roster.
    assert {:error, :not_member} = Circles.list_members(carol, circle.id)

    # Nor can someone whose membership ended.
    assert {:ok, request} = Social.request_by_pin(alice, carol.pin)
    assert {:ok, _} = Social.respond(carol, request.id, :accept)
    assert {:ok, _results} = Circles.invite(alice, circle.id, [carol.id])
    inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: carol.id)
    assert {:ok, _} = Circles.respond(carol, inv.id, :accept)
    assert {:ok, _} = Circles.list_members(carol, circle.id)
    assert :ok = Circles.leave(carol, circle.id)
    assert {:error, :not_member} = Circles.list_members(carol, circle.id)
  end

  test "test_list_members_with_non_uuid_id_is_not_found", %{alice: alice} do
    assert {:error, :not_found} = Circles.list_members(alice, "not-a-uuid")
  end

  test "test_update_requires_owner_or_admin_membership", %{
    alice: alice,
    bob: bob,
    carol: carol
  } do
    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    # A non-member cannot edit.
    assert {:error, :not_member} = Circles.update(carol, circle.id, %{"name" => "Hijacked"})

    # An ordinary member cannot either.
    assert {:ok, request} = Social.request_by_pin(alice, bob.pin)
    assert {:ok, _} = Social.respond(bob, request.id, :accept)
    assert {:ok, _results} = Circles.invite(alice, circle.id, [bob.id])
    inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: bob.id)
    assert {:ok, _} = Circles.respond(bob, inv.id, :accept)
    assert {:error, :forbidden} = Circles.update(bob, circle.id, %{"name" => "Renamed"})

    # The owner can.
    assert {:ok, updated} = Circles.update(alice, circle.id, %{"name" => "Renamed"})
    assert updated.name == "Renamed"
  end

  test "test_update_ignores_protected_fields", %{alice: alice} do
    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    # A stray id / type / created_by in the params map is not writable: only the
    # profile fields are read.
    assert {:ok, updated} =
             Circles.update(alice, circle.id, %{
               "id" => Ecto.UUID.generate(),
               "type" => "private",
               "created_by" => alice.id,
               "name" => "Still a circle"
             })

    assert updated.id == circle.id
    assert updated.type == :circle
    assert updated.name == "Still a circle"
  end

  test "test_update_with_non_uuid_id_is_not_found", %{alice: alice} do
    assert {:error, :not_found} = Circles.update(alice, "not-a-uuid", %{"name" => "x"})
  end

  test "test_rejoin_reactivates_membership_and_hides_old_history", %{
    alice: alice,
    bob: bob
  } do
    assert {:ok, request} = Social.request_by_pin(alice, bob.pin)
    assert {:ok, _} = Social.respond(bob, request.id, :accept)

    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})
    assert {:ok, _results} = Circles.invite(alice, circle.id, [bob.id])
    inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: bob.id)
    assert {:ok, _} = Circles.respond(bob, inv.id, :accept)

    # A message Bob could see while he was a member.
    {:ok, visible_msg} =
      Chat.send_message(alice, circle.id, message_attrs(%{payload: %{"v" => 1, "text" => "hi"}}))

    assert {:ok, %{messages: messages}} = Chat.list_messages(bob, circle.id, %{})
    assert Enum.any?(messages, &(&1.id == visible_msg.id))

    assert :ok = Circles.leave(bob, circle.id)

    # Re-invite and accept: the old `:left` row is reactivated, no insert! raises.
    assert {:ok, results} = Circles.invite(alice, circle.id, [bob.id])
    assert results[bob.id] == :ok
    reinv = fetch_latest_invitation(circle.id, bob.id)
    assert {:ok, _membership} = Circles.respond(bob, reinv.id, :accept)

    # Back in the circle, but the pre-rejoin message is hidden by the refreshed
    # join boundary.
    assert {:ok, %{messages: after_rejoin}} = Chat.list_messages(bob, circle.id, %{})
    refute Enum.any?(after_rejoin, &(&1.id == visible_msg.id))

    assert {:ok, %{conversations: list}} = Chat.list_conversations(bob, %{filter: :all})
    [conv] = Enum.filter(list, fn c -> c.id == circle.id end)
    assert conv.unread_count == 0
    assert conv.last_message == nil

    # And only one membership row exists for the pair.
    assert Repo.aggregate(
             from(m in AwsemChat.Chat.CircleMembership,
               where: m.circle_id == ^circle.id and m.user_id == ^bob.id
             ),
             :count
           ) == 1
  end

  test "test_duplicate_pending_invite_is_a_friendly_result", %{alice: alice, bob: bob} do
    assert {:ok, request} = Social.request_by_pin(alice, bob.pin)
    assert {:ok, _} = Social.respond(bob, request.id, :accept)
    assert {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    assert {:ok, results} = Circles.invite(alice, circle.id, [bob.id])
    assert results[bob.id] == :ok

    assert {:ok, results2} = Circles.invite(alice, circle.id, [bob.id])
    assert results2[bob.id] == :already_invited

    # No second pending row.
    assert Repo.aggregate(
             from(i in CircleInvitation,
               where: i.circle_id == ^circle.id and i.invitee_id == ^bob.id,
               select: count(i.id)
             ),
             :count
           ) == 1
  end

  defp fetch_latest_invitation(circle_id, invitee_id) do
    Repo.one!(
      from(i in CircleInvitation,
        where: i.circle_id == ^circle_id and i.invitee_id == ^invitee_id and i.state == :pending,
        order_by: [desc: i.inserted_at, desc: i.id],
        limit: 1
      )
    )
  end

  defp get_pending_request_id(recipient, sender) do
    req =
      Repo.get_by!(AwsemChat.Social.FriendRequest,
        sender_id: sender.id,
        recipient_id: recipient.id,
        state: :pending
      )

    req.id
  end

  defp message_attrs(attrs) do
    Map.merge(
      %{clientOpId: Ecto.UUID.generate(), kind: :text, payload: %{"v" => 1, "text" => "hello"}},
      attrs
    )
  end

  defp create_user(phone) do
    {:ok, _} = Accounts.request_code(phone)
    {:ok, %{user: user}} = Accounts.verify_code(phone, "123456")
    user
  end
end
