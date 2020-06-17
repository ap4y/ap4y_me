+++
title = "Homelabbing with Kubernetes"
date = 2020-06-10
+++

> [Homelabbing](https://www.reddit.com/r/homelab/) is an interesting
  way to learn more about DevOps and get into self-hosting. Kubernetes
  has brought a lot of changes into application deployment but
  learning curve makes it a bit harder to get into. In this post I
  will overview k8s deployment options and benefits for homelabs.

I have been homelabbing and self-hosting for a few years. I started
with a single RPI running behind PfSense firewall hosting my personal
website. The next iteration was a NAS server made from old components
hosting more apps for my internal network. Then finally transitioned
to a racked used HP DL320e you can see below, this setup hosts all my
internal and public services including `smtp`, `imap`, `xmpp` servers
and a few `http` apps I use.

{{< figure src="homelab.jpg" title="" >}}

With the time it became tedious to manage various interconnected
services. I tried different approaches: host daemons, containers
wrapped as systemd units but it was still clunky to manage and
upgrade. Overall I felt that containers is the way to go since I was
using a lot of Golang based apps and smaller services, so I felt like
`k8s` will be a good fit for my setup.

## Selecting a Kubernetes distro

Kubernetes is a set of
[components](https://kubernetes.io/docs/concepts/overview/components/)
that can be run in various configurations including hosting all of
them on a single host. Pre-configured `k8s` deployments are usually
referred as
[distros](https://kubernetes.io/docs/concepts/cluster-administration/cluster-administration-overview/#planning-a-cluster),
homelab naturally falls into self-managed distros category and among
those single host and minimal distributions will be preferable. The
most popular options for that category are
[microk8s](https://microk8s.io/) and [k3s](https://k3s.io/).

Both `microk8s` and `k3s` are fairly simple to install, the former is
distributed as a `snap` and the later is distributed as a single
binary. Both use `containerd` runtime by default and can use a local
docker daemon. In both cases `k8s` network implementation provided via
the [flannel](https://github.com/coreos/flannel) and it can be
extended via CNI plugins. `k3s` uses `sqlite3` as a storage backend by
default and `microk8s` defaults to etcd. `k3s` has a nice set of
bundled addons like a lightweight loadbalancer and `traefik` ingress
controller, with `microk8s` you have access to various addons through
the `microk8s enable` which supports `nginx` ingress controller and
`metallb` loadbalancer.

I have used both in the past and experience is roughly the same, the
only benefit of `microk8s` I found for my personal setup is an easier
access to the ZFS storage backend for the `containerd`. ZFS
snapshotter is not included into `containerd` bundled with `k3s`, so
you have to configure it to use `containerd` [installed on your
system](https://blog.nobugware.com/post/2019/k3s-containterd-zfs/). `microk8s`
already relies on the system `containerd` so the process is [more
straightforward](https://github.com/ubuntu/microk8s/issues/401#issuecomment-480945986).

One important thing to note is to make sure your `k8s` API server is
not exposed to a public network. I use 2 interfaces on my server that
are located in physically separated networks and I have setup
necessary rules to use 2 different gateways. `microk8s` will listen on
the [default interface](https://microk8s.io/docs/ports) which is a
private interface in my case but `k3s` will [bind to
0.0.0.0](https://rancher.com/docs/k3s/latest/en/installation/install-options/server-config/#listeners)
and this is potentially unsafe and not recommended, especially so if
your pubic network is exposed.

## Unified certificate management

If you ever had a rough time with managing short lived Let's Encrypt
certificates used by multiple `http` and `tcp` services then you are
going to like [cert-manager](https://cert-manager.io/) k8s addon. This
addon provides you with an unified way to manage certificates across
all your `k8s` deployments and `http` ingress channels. Installation
process is [fairly
simple](https://cert-manager.io/docs/installation/kubernetes/#installing-with-regular-manifests)
so I'm not going to cover that. Once you have `cert-manager` running
you can request certificates by creating the `Issuer` and
`Certificate` resources, for example:

{{< highlight yaml >}}
apiVersion: cert-manager.io/v1alpha2
kind: Issuer
metadata:
  name: letsencrypt-issuer
spec:
  acme:
    email: mail@ap4y.me
    server: https://acme-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: letsencrypt-account-key
    solvers:
    - http01:
       ingress:
         class: nginx
---
apiVersion: cert-manager.io/v1alpha2
kind: Certificate
metadata:
  name: ap4y-me-certificate
spec:
  secretName: ap4y-me-certificate
  issuerRef:
    name: letsencrypt-issuer
    kind: Issuer
  dnsNames:
  - ap4y.me
  - foo.ap4y.me
  - bar.ap4y.me
{{< /highlight >}}

You can check the progress by running:

{{< highlight sh >}}
$ kubectl get certificate
NAME                  READY   SECRET                AGE
ap4y-me-certificate   True    ap4y-me-certificate   9d
{{< /highlight >}}

Certificate will be managed by `cert-manager` and is stored in a
`Secret` resource under `ap4y-me-certificate` name. You can map this
certificate directly to a `Pod` or make ingress controller do TLS
termination for your `http` services:

{{< highlight yaml >}}
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: website
  annotations:
    cert-manager.io/issuer: letsencrypt-issuer
    ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - ap4y.me
      secretName: ap4y-me-certificate
  rules:
  - host: ap4y.me
    http:
      paths:
      - path: /
        backend:
          serviceName: website
          servicePort: 80
{{< /highlight >}}

`cert-manager` was a huge time saver for me, I don't have to worry
about fixing certificate permissions and restarting services once
certificates were rotated.

## Control over the inbound traffic

I have a public network on my server going through the VPN that
provides an external static IP and a split DNS between public and
private networks so my home computers would access my services
directly without going though the public network. Previously I had
workarounds on my server so I could bind services to necessary
addresses for the per network port forwarding. With `k8s` service
discovery per network port forwarding is much easier to manage through
the `Service` resources. It's even simpler with a loadbalancer addon:
you can have static endpoints (IP and port combinations) that will be
routed to a service based on a `Service` definition.

With [metallb](https://metallb.universe.tf/) loadbalancer addon you
can expose services on IPs from the pre-configured range. For example
if you have two interfaces on your server `192.168.1.10` and
`10.10.1.10` you can setup `metallb` to source IPs from the ranges
`192.168.1.240-192.168.1.250` and `10.10.1.240-10.10.1.250`. This will
allow you to expose services in desired networks on desired ports, you
can also pick a desired IP from the range:

{{< highlight yaml >}}
apiVersion: v1
kind: Service
metadata:
  name: smtpd
  annotations:
    metallb.universe.tf/allow-shared-ip: ap4y.home
spec:
  ports:
  - port: 25
    targetPort: 25
    protocol: TCP
    name: smtp
  selector:
    app: smtpd
  type: LoadBalancer
  loadBalancerIP: 192.168.1.250
{{< /highlight >}}

With `metallb.universe.tf/allow-shared-ip: ap4y.home` annotation you
can use the same IP address in multiple services with the same sharing
key.

Service discovery significantly simplified NAT and blocking rules on
my PfSense firewall and split DNS over loadbalancer IPs is much
easier to do.

## Declarative application deployments

It's rare for an application to exist in isolation and in many
situation applications will have dependencies on each other. A good
example is an OpenSMTPD service that needs access to a DKIM proxy to
sign outbound mail and to a Dovecot service to deliver mail to a local
mailbox via `lmtp`. Setting up those dependencies across configs and
daemons can be a daunting task and this is where `k8s` really shines
with the declarative approach. There are multiple ways to achieve
desired outcome with `k8s`, below I will list my approach to `smtpd`
deployment.

First we crate necessary configs for `opensmtpd`:

{{< highlight yaml >}}
apiVersion: v1
kind: ConfigMap
metadata:
  name: smtpd-config
data:
  creds: |
    ap4y    $6$hash
  domains: |
    ap4y.me
  users: |
    mail@ap4y.me         ap4y    
  smtpd.conf: |
    pki mx.ap4y.me cert  "/etc/ssl/smtpd/tls.crt"
    pki mx.ap4y.me key   "/etc/ssl/smtpd/tls.key"
    
    table creds     file:/etc/smtpd/creds
    table domains   file:/etc/smtpd/domains
    table users     file:/etc/smtpd/users
    
    listen on 0.0.0.0 port 10028 tag DKIM_OUT
    ...

    action "dovecot" lmtp dovecot-lmtp.default.svc.cluster.local:2525 virtual <users>
    action "outbound" relay helo mx.ap4y.me
    action "dkim" relay host smtp://127.0.0.1:10027
    ...
{{< /highlight >}}

Few things to note about the above `ConfigMap`:

- You can have multiple configs under the same `ConfigMap`: `creds`,
  `domains`, `users` and `smtpd.conf`. We can map those via a single
  directive under the `/etc/ssl/smtpd`.
- TLS certificates issued by the `cert-manager` will be mapped to the
  container under `/etc/ssl/smtpd`.
- We can use a
  [sidecar](https://kubernetes.io/docs/concepts/workloads/pods/pod-overview/#understanding-pods)
  container for the `dkimproxy`. This will make ports `10027` and
  `10028` accessible on `127.0.0.1` under both containers.
- Dovecot will be created as a separate `Deployment` with a `Service`,
  `k8s` with
  [CoreDNS](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#services)
  will make it available on `dovecot-lmtp.default.svc.cluster.local`.

I will omit configs for the `dkimproxy` for simplicity. We can now
create a `Deployment` resource of 1 replica:

{{< highlight yaml >}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: smtpd
spec:
  replicas: 1
  selector:
    matchLabels:
      app: smtpd
  template:
    metadata:
      labels:
        app: smtpd
    spec:
      containers:
      - name: smtpd
        image: ap4y/opensmtpd:6.6.4p1-r0
        ports:
        - containerPort: 25
        - containerPort: 587
        volumeMounts:
        - name: config
          mountPath: /etc/smtpd
          readOnly: true
        - name: certs
          mountPath: /etc/ssl/smtpd
          readOnly: true
      - name: dkimproxy
        image: ap4y/dkimproxy:1.4.1-r5
        volumeMounts:
        - name: domainkey
          mountPath: /var/dkimproxy/mx.ap4y.me
          readOnly: true
      volumes:
      - name: config
        configMap:
          name: smtpd-config
      - name: certs
        secret:
          secretName: ap4y-me-certificate
          defaultMode: 0700
      - name: domainkey
        secret:
          secretName: ap4y-me-dkim
{{< /highlight >}}

This `Deployment` will start `smtpd` and `dkimproxy` sidecar with
necessary mounts, `dovecot` service will be eventually available on
it's DNS name. We also define necessary ports that can be exposed in
a `Service` as described in the previous section.

Setting up services via a `yaml` manifest takes time to get used to
it, but once I passed initial learning curve it was an effortless
process. I would say it's a more convenient way than setting up
configs and service daemons on a disk. Upgrade and re-deployment
process is pretty straightforward and for the most part is managed by
`k8s`.

This will be my intro into homelabbing with `k8s`. There are a lot of
interesting `k8s` features you can use to improve your deployments, it
will be hard to cover everything in a single post. I highly recommend
to give a `k8s` a try in your homelab.
