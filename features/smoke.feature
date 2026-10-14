Feature: The smoke service
  The smoke stack runs one WebService in dev. It shows that a service in dev is reachable through the
  shared Gateway, over HTTPS only.

  Scenario: The smoke service answers over HTTPS at its dev hostname
    When I request "https://smoke.dev.cycsail.team/"
    Then the response status is 200
    And the response body contains "Hello, world!"

  Scenario: HTTP redirects to HTTPS
    When I request "http://smoke.dev.cycsail.team/" without following redirects
    Then the response redirects to "https://smoke.dev.cycsail.team/"
