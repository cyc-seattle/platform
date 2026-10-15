Feature: Dev is isolated from prod
  Dev shares the cluster and the Gateway with prod. These scenarios run as the identity that deploys
  dev, which is deploy-dev in CI.

  Background:
    Given I am signed in to dev's cluster

  Scenario: A dev route for a prod hostname is not accepted
    When I create an HTTPRoute in dev for "isolation-test.cycsail.team"
    Then the Gateway doesn't accept the route

  Scenario Outline: deploy-dev can deploy to dev
    When I ask to create "<resource>" in namespace "dev"
    Then the cluster allows it

    Examples:
      | resource                             |
      | deployments.apps                     |
      | httproutes.gateway.networking.k8s.io |

  Scenario Outline: deploy-dev can't create anything in another namespace
    When I ask to create "<resource>" in namespace "<namespace>"
    Then the cluster forbids it

    Examples:
      | resource                               | namespace   |
      | configmaps                             | default     |
      | deployments.apps                       | gateway     |
      | httproutes.gateway.networking.k8s.io   | gateway     |
      | gateways.gateway.networking.k8s.io     | gateway     |
      | secrets                                | kube-system |
      | rolebindings.rbac.authorization.k8s.io | prod        |

  Scenario Outline: deploy-dev can't create anything cluster-wide
    When I ask to create "<resource>" outside any namespace
    Then the cluster forbids it

    Examples:
      | resource                                      |
      | namespaces                                    |
      | clusterroles.rbac.authorization.k8s.io        |
      | clusterrolebindings.rbac.authorization.k8s.io |

  Scenario: deploy-dev reaches a dev Service through the API's service proxy
    When I GET "/" from the Service "smoke" on port 80 through the API's service proxy
    Then it answers with status 200

  Scenario: A dev pod can't reach a mail server outside the cluster
    When a pod in dev connects to "smtp.gmail.com:25", "smtp.gmail.com:465", "smtp.gmail.com:587", and "www.google.com:443"
    Then only "www.google.com:443" answers
