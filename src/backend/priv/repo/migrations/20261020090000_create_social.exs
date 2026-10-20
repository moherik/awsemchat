defmodule AwsemChat.Repo.Migrations.CreateSocial do
  use Ecto.Migration

  def change do
    create table(:friend_requests, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :sender_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :recipient_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :state, :string, null: false, default: "pending"

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create index(:friend_requests, [:sender_id])
    create index(:friend_requests, [:recipient_id])

    # At most one pending request per direction. Answered rows are kept as
    # history, so the constraint is partial rather than on the pair outright.
    create unique_index(:friend_requests, [:sender_id, :recipient_id],
             where: "state = 'pending'",
             name: :friend_requests_pending_sender_recipient_index
           )

    create table(:friendships, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :friend_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      add :created_at, :utc_datetime, null: false
    end

    create index(:friendships, [:user_id])
    create index(:friendships, [:friend_id])
    create unique_index(:friendships, [:user_id, :friend_id])

    create table(:blockings, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :blocker_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :blocked_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      add :created_at, :utc_datetime, null: false
    end

    create index(:blockings, [:blocker_id])
    create index(:blockings, [:blocked_id])
    create unique_index(:blockings, [:blocker_id, :blocked_id])
  end
end
