defmodule AwsemChat.Repo.Migrations.CreateCircles do
  use Ecto.Migration

  def change do
    create table(:circle_memberships, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :circle_id, references(:conversations, type: :binary_id, on_delete: :delete_all),
        null: false

      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :role, :string, null: false
      add :state, :string, null: false
      add :joined_at, :utc_datetime_usec, null: false
      add :left_at, :utc_datetime_usec

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:circle_memberships, [:circle_id, :user_id])
    create index(:circle_memberships, [:user_id])
    create index(:circle_memberships, [:circle_id, :state])

    create table(:circle_invitations, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :circle_id, references(:conversations, type: :binary_id, on_delete: :delete_all),
        null: false

      add :inviter_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :invitee_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :state, :string, null: false

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create index(:circle_invitations, [:circle_id])
    create index(:circle_invitations, [:invitee_id])

    create unique_index(:circle_invitations, [:circle_id, :invitee_id],
             where: "state = 'pending'"
           )
  end
end
