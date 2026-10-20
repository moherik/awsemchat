defmodule AwsemChatWeb.ErrorJSONTest do
  use AwsemChatWeb.ConnCase, async: true

  test "renders 404 in Phoenix's default shape" do
    assert AwsemChatWeb.ErrorJSON.render("404.json", %{}) == %{errors: %{detail: "Not Found"}}
  end

  test "renders 500 as the API error envelope" do
    assert AwsemChatWeb.ErrorJSON.render("500.json", %{}) ==
             %{error: %{code: "internal_error"}}
  end

  test "an unhandled raise on a route answers internal_error and leaks nothing" do
    # The route raises. Phoenix's render-errors wrapper renders the response and
    # then re-raises, so the failure is not swallowed: a real bug still fails the
    # test instead of quietly becoming a 500 the test does not notice.
    {exception, stack} =
      try do
        get(build_conn(), "/api/v1/__probe/boom")
        # If the raise were swallowed this line would be reached and the test
        # would fail on the missing exception below.
        flunk("the probe route did not raise")
      rescue
        e -> {e, __STACKTRACE__}
      end

    assert %RuntimeError{message: message} = exception
    assert message == "probe-exception-marker-c0ffee"

    # What the wrapper renders for that exception is the envelope, and only the
    # envelope: none of the exception's data reaches the bytes on the wire.
    assigns = %{kind: :error, reason: exception, stack: stack, status: 500}
    body = AwsemChatWeb.ErrorJSON.render("500.json", assigns) |> Jason.encode!()

    assert Jason.decode!(body) == %{"error" => %{"code" => "internal_error"}}
    refute body =~ "probe-exception-marker"
    refute body =~ "RuntimeError"
    refute body =~ "error_probe_controller"
    refute body =~ "stacktrace"
  end
end
