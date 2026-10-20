defmodule AwsemChatWeb.Router do
  use AwsemChatWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :authenticated do
    plug AwsemChatWeb.Auth
  end

  scope "/api/v1", AwsemChatWeb do
    pipe_through :api

    post "/auth/request_code", AuthController, :request_code
    post "/auth/verify_code", AuthController, :verify_code

    # A route that raises on purpose, for the unhandled-exception test. Routed
    # only in the test env; see `AwsemChatWeb.ErrorProbeController`. It sits
    # outside the Auth pipeline so the raise happens on every request.
    if Application.compile_env(:awsemchat, :test_error_routes, false) do
      get "/__probe/boom", ErrorProbeController, :boom
    end
  end

  scope "/api/v1", AwsemChatWeb do
    pipe_through [:api, :authenticated]

    get "/me", MeController, :show
    patch "/me", MeController, :update
    post "/auth/logout", AuthController, :logout
    post "/media", MediaController, :create
    get "/media/:id", MediaController, :show

    get "/friends", FriendsController, :index
    post "/friends/requests", FriendsController, :create_request
    get "/friends/requests", FriendsController, :list_requests
    post "/friends/requests/:id/accept", FriendsController, :accept_request
    post "/friends/requests/:id/decline", FriendsController, :decline_request
    post "/friends/requests/:id/cancel", FriendsController, :cancel_request
    delete "/friends/:userId", FriendsController, :delete

    get "/blocks", FriendsController, :list_blocks
    post "/blocks", FriendsController, :create_block
    delete "/blocks/:userId", FriendsController, :delete_block

    get "/conversations", ConversationsController, :index
    post "/conversations", ConversationsController, :create
    get "/conversations/:conversationId", ConversationsController, :show
    get "/conversations/:conversationId/messages", ConversationsController, :list_messages
    get "/conversations/:id/media", ConversationsController, :list_media
    post "/conversations/:conversationId/messages", ConversationsController, :send_message
    put "/conversations/:id/preferences", ConversationsController, :update_preferences
    patch "/conversations/:id/preferences", ConversationsController, :update_preferences
    post "/conversations/:id/position", ConversationsController, :update_position

    post "/circles", CirclesController, :create
    get "/circles/:id", CirclesController, :show
    patch "/circles/:id", CirclesController, :update
    post "/circles/:id/invitations", CirclesController, :invite
    post "/invitations/:id/accept", CirclesController, :accept_invitation
    post "/invitations/:id/decline", CirclesController, :decline_invitation
    post "/circles/:id/leave", CirclesController, :leave
    delete "/circles/:id/members/:userId", CirclesController, :remove_member
    get "/circles/:id/members", CirclesController, :list_members
  end
end
