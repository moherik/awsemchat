defmodule Mix.Tasks.Awsemchat.Seed do
  @shortdoc "Seeds the demo bots and prints their phones and PINs"

  @moduledoc """
  Seeds the bot accounts and prints the credentials needed to use them.

      mix awsemchat.seed

  Idempotent: running it again refreshes the same three accounts rather than
  creating new ones. Sign in as a bot with its phone (any dev OTP code works) to
  watch a conversation from the bot's side, or add a bot as a friend from your
  own account with its PIN and start talking — `AwsemChat.Bots` answers.
  """

  use Mix.Task

  @requirements ["app.start"]

  @impl Mix.Task
  def run(_args) do
    bots = AwsemChat.Seeds.seed()

    Mix.shell().info("""

    Seeded #{length(bots)} bots. Sign in with a phone (dev OTP is 123456) or add
    one as a friend by PIN from your own account — they reply on their own.

    #{table(bots)}
    """)
  end

  defp table(bots) do
    rows =
      Enum.map(bots, fn bot ->
        [bot.display_name, bot.phone, bot.pin, bot.status_text]
      end)

    widths =
      ["Name", "Phone", "PIN", "Status"]
      |> Enum.zip(Enum.zip_with(rows, & &1))
      |> Enum.map(fn {header, column} ->
        column |> Enum.map(&String.length/1) |> Enum.max() |> max(String.length(header))
      end)

    [["Name", "Phone", "PIN", "Status"] | rows]
    |> Enum.map_join("\n", fn row ->
      row
      |> Enum.zip(widths)
      |> Enum.map_join("  ", fn {cell, width} -> String.pad_trailing(cell, width) end)
      |> String.trim_trailing()
    end)
  end
end
