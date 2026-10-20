defmodule AwsemChat.MediaStorageCase do
  @moduledoc """
  Test helper for the media subsystem's per-test state: the store's on-disk root
  and the upload settings (`limit`, `allowed_mime`, `store`).

  Both are resolved per process by the production code, which falls back to
  application env and then to its defaults. Per process is the point: async test
  modules share app env, so a global override lets one test's cleanup reset
  another's settings — corrupting its assertions, and for the root, writing
  uploads into the real `priv/media/` once the override is cleared.

  Production sets nothing here and reads the defaults, so behaviour is
  unchanged.
  """

  @doc """
  Isolates media state for the calling test process: a private storage root that
  is removed on exit, plus `settings` applied to `AwsemChat.Media`. Returns the
  root path.
  """
  def isolate_media_storage(settings \\ []) do
    root = Path.join(System.tmp_dir!(), "awsemchat-media-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    Process.put(:media_root, root)

    Enum.each(settings, fn {key, value} -> Process.put({AwsemChat.Media, key}, value) end)

    ExUnit.Callbacks.on_exit(fn -> File.rm_rf(root) end)
    root
  end
end
