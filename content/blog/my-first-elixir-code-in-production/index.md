+++
title = "My first Elixir code in production"
date = 2013-11-06
draft = true
+++

> Programming language with unique features is a powerful tool in right hands. It is really interesting how efficiently you can solve some tasks if you aware of such features. Recently I learned some features of Elixir and how they can be helpful for different tasks. 

It is hard to describe Elixir in couple words, so I just put a statement from the official [web page](http://elixir-lang.org/):

> Elixir is a functional, meta-programming aware language built on top of the Erlang VM. It is a dynamic language with flexible syntax and macro support that leverages Erlang's abilities to build concurrent, distributed and fault-tolerant applications with hot code upgrades.

Rather than trying to describe this language with words, I will try to show language features by implementing application step-by-step. I would suggest good learning resources throughout the text.

## Getting started with Elixir

I knew about Elixir for quite a while, I always was interested in learning functional language, just never had a good opportunity. A week ago I had a free time, so I decided to spend some time learning Elixir. I started with [official guide](http://elixir-lang.org/getting_started/1.html). I finished it really fast, installed elixir and played a bit.

For some reason it didn't rise my interest, so I decided to read a blog posts. Most memorable posts I found in [Benjamin Tan's blog](http://benjamintanweihao.github.io/). I really recommend it if your are looking for some inspiration.

After that I decided to buy [Programming Elixir](http://pragprog.com/book/elixir/programming-elixir) by Dave Thomas. This was the step that helped me to understand Elixir's philosophy much better, I read first part of the book within a couple hours and finished all exercises. I really recommend this book, my favourite things are obviously examples and exercises, they give you a clear understanding how you can use this code in everyday applications. The book itself focused on transition from imperative languages to the functional languages, so it helped me to change my mindset quite a lot.

When I returned to the office on Monday I received a new task: migrate about 400 millions MongoDB documents to the new data structure. I will not be describing why this happened, but unfortunately we had to do that. It was quite a simple migration, but amount of documents was quite high.

I implemented migration with Ruby (MRI), just a simple multiple cursors. Tried it unfortunately it seemed like MongoDB wasn't saturated (I checked it with `mongostat`). I tried Rubinius with real threads, even in this case with multiple connections it wasn't saturating MongoDB. I decided to do migration from multiple machines. I also had potential problems if one of my workers fail, since I didn't store migration state anywhere and didn't want to delete previous documents. I already knew that I could spawn multiple Elixir processes on distributed machine and control them with supervisor, supervisor also could provide workers recovery.

## Implementing distributed MongoDB migration

Our task is quite simple. Assume we have document:

{{< highlight text >}}
{
  a_id: ObjectId(...),
  d_id: ObjectId(...),
  n_id: ObjectId(...),
  date: Date('2012-03-03 10:15:23'),
  value: 10,
}
{{< /highlight >}}

Fields `a_id`, `d_id`, `n_id` are optional. We need create document for each `_id` field with such structure:

{{< highlight text >}}
{
  _id: {
    p: ObjectId(...),
    d: Date('2012-03-03 10:00:00')
  },
  h: {
    '10': {
      'c': 10,
      't': 100
    },
  ...
  }
}
{{< /highlight >}}

Where `p` is a value of the corresponding `_id` field, `d` is a beginning of the day for the `date` value. Hashes inside `h` field are just counters for the corresponding hours, `c` increments by 1 for each document, `t` increments by value.

## Dependency management

I used `mix` for this project, so I created my project with `mix new migration`. Obviously, there is no Elixir driver for MongoDB, but we can use Erlang driver without any penalties. So, I did a fast search on the MongoDB documentation, and found [Erlang driver](http://docs.mongodb.org/ecosystem/drivers/erlang/), it hosted on [Github](https://github.com/mongodb/mongodb-erlang). It was build for Erlang R15, while I used R16, quick search gave me [fork for R16](https://github.com/mururu/mongodb-erlang/tree/master). I added it as dependency into the `mix.exs`:

{{< highlight elixir >}}
defp deps(:dev) do
  [ { :mongodb, github: "mururu/mongodb-erlang" } ]
end
{{< /highlight >}}

I also started it with as OTP application dependency:

{{< highlight elixir >}}
def application do
  [
    applications: [ :mongodb ],
    mod: { Migration, [] }
  ]
end
{{< /highlight >}}

After doing `mix deps.get` I was able to use driver in our application. Next I decided to implement simple wrapper module for driver, that will encapsulate MongoDB communication logic.

## Implementing MongoDB communication

I started with simple entry function `run`.

{{< highlight elixir >}}
defmodule Migration.MongoDB do

  @events_count 1000
  @db_name :test

  def run(pid, pool, query // {}, index // 0) do
    case :resource_pool.get(pool) do
      { :ok, connection } ->
        migrate(connection, query, index * @events_count, @events_count)
        pid <- { :finished, self }
      { :error, reason } -> IO.puts "Failed #{reason}"
    end
  end
end
{{< /highlight >}}

I defined module `Migration.MongoDB`, attributes `@events_count` (number of documents to process) and `@db_name`. This function `run/4` has following parameters:

- pid of the parent process, will be used to notify parent process once it `:finished`.
- pool is a predefined pool of the MongoDB connections.
- query with default value `{}`, will be used to migrate particular subset of the data.
- index with default value 0, will be used to calculate offset for the query.

I requested connection from the pool with `:resource_pool.get/1` and used pattern matching to check if the operation was successful. I started migration code with `migrate/4` method, once it finished I will send `{ :finished, self }` tuple to the parent process. I will continue with `migrate/4` method:

{{< highlight elixir >}}
defp migrate(connection, query, skip // 0, limit) do
  :mongo.do(:unsafe, :master, connection, @db_name, fn ->
    :mongo.find(:collection, query, {}, skip)
    |> process_cursor(limit)
  end)
end
{{< /highlight >}}

I defined private function and issued request to `:collection` (defined with atom) with `:mongo.find/4` inside `:mongo.do/5` function's anonymous function. This operation returns cursor for the issued request. I used pipeline operator to call the `process_cursor/2` function which will iterate through the cursor.

{{< highlight elixir >}}
defp process_cursor(cursor, 0), do: :mongo.close_cursor(cursor)
defp process_cursor(cursor, index) do
  case :mongo.next(cursor) do
    { data } ->
      :bson.fields(data)
      |> parse_document

      process_cursor(cursor, apps, index - 1)
    _ -> :mongo.close_cursor(cursor)
  end
end
{{< /highlight >}}



This time I used recursion with tail optimisation and multiple function defenitions to iterate through the cursor with `:mongo.next/1`. Each iteration converts returned list into keyword list with `bson.fields/2` and pipelines it into `parse_document/1` function. I have 2 end conditions:

- Operation index is 0. Defined with additional body.
- Cursor is finished. In this case `:mongo.next/1` returns empty tuple, I match it with unused variable.

## Implementing migration process

Function `parse_document/1` inserts document whenever required:

{{< highlight elixir >}}
defp parse_document(doc) do
  code  = doc[:code]
  date  = :calendar.now_to_universal_time(doc[:date])
  value = doc[:value]

  case Migration.Operations.upsert(code, doc[:a_id], date, value, true) do
    { find, update } -> :mongo.repsert(:"a.d", find, update)
    _ -> nil
  end

  #similar operations for other fields
end
{{< /highlight >}}

This function extracts values from keyword list, converts date to the UTC tuple with `:calendar.now_to_universal_time/1`. It provides this values to the `upsert/5` function from `Migration.Operations` module:

{{< highlight elixir >}}
defmodule Migration.Operations do

  @event_open_code 1100
  @event_session_code 1000

  def upsert(@event_open_code, parent_id, {date, {hour, minute, _}}, _value, _with_session)
  when parent_id != nil do
    update = {
      "$inc", { "h.#{hour}.c", 1 }
    }
    { find_clause(parent_id, date), update }
  end

  def upsert(@event_session_code, parent_id, {date, {hour, minute, _}}, value, true)
  when parent_id != nil do
    update = {
      "$inc", { "h.#{hour}.t", value }
    }
    { find_clause(parent_id, date), update }
  end

  def upsert(_code, _parent_id, _date, _value, _with_session), do: { :error }

  defp find_clause(parent_id, date) do
    formatted_date = Migration.DateUtils.datetime_to_unixtime({ date, { 0, 0, 0 } })
    {
      :_id, { :p, parent_id, :d, formatted_date }
    }
  end
end
{{< /highlight >}}


I defined `Migration.Operations` module with only one function `upsert/5`. This function has multiple bodies:

- First body will be invoked if provided code is equal to `@event_open_code` and guard clause (`parent_id != nil`) condition satisfied.
- Second body will be invoked if provided code is equal to `@event_session_code` and guard clause condition satisfied.
- Otherwise third body with unused variables will be invoked. It returns `{ :error }` tuple.

I also use pattern matching on provided date to format it. `upsert/5` function expects date in standard Erlang tuple `{ {2012, 03, 03}, {10, 15, 22} }`. I matched it with `{date, {hour, minute, _}}` and formatted to `{date, { 0, 0, 0 }}`. I also converted this date into expected unixtime format with `datetime_to_unixtime/1` from `Migration.DateUtils` module which is quite simple, so I will omit it.

I also wrote some simple unit tests for the `Migration.Operations` module to check if multiple bodies are working correctly.

## Writing unit tests

{{< highlight elixir >}}
defmodule OperationsTest do
  use ExUnit.Case

  import Migration.Operations
  import Migration.DateUtils

  @event_date { {2012, 03, 03},{10, 15, 25} }
  @unixtime datetime_to_unixtime({ {2012, 03, 03},{0, 0, 0} }

  test "event with nil parent_id should return :error" do
    assert upsert(1000, nil, @event_date, 100, true) == { :error }
    assert upsert(1100, nil, @event_date, 100, true) == { :error }
  end

  test "event with incorrect code should return :error" do
    assert upsert(777, nil, @event_date, 100, true) == { :error }
  end

  test "app open event should produce correct find and update clause" do
    { find, update } = upsert(1100, {"foo"}, @event_date, 100, true)
    assert find == {
      :_id, {:p, {"foo"}, :d, @unixtime }
    }
    assert update == {
      "$inc", {"h.10.c", 1}
    }
  end

  test "app session event should produce correct find and update clause" do
    { find, update } = upsert(1000, {"foo"}, @event_date, 100, true)
    assert find == {
      :_id, {:p, {"foo"}, :d, @unixtime }
    }
    assert update == {
      "$inc", {"h.10.t", 100}
    }
  end
end
{{< /highlight >}}

This tests are quite verbose, so I will move to the process spawn code.

## Spawning distributed processes

I will define entry point for our application that will allow us to compile it into command line utility.

{{< highlight elixir >}}
defmodule Migration do
  # some code omitted
  @max_connections 100
  @max_processes 10
  @host :localhost
  @node1 :"one@192.168.178.30"
  @node2 :"one@192.168.178.31"

  def main(_args) do
    factory = :mongo.connect_factory(@host)
    pool = :resource_pool.new(factory, @max_connections)

    Node.connect(@node1)
    Node.connect(@node2)

    Node.list
    |> Enum.reduce([], fn(node, acc) ->
      acc ++ start_node(node, pool)
    end)
    |> monitor_process

    :resource_pool.close(pool)
  end

  defp start_node(node, pool) do
    (1..@max_processes)
    |> Enum.map(fn(idx) ->
      Node.spawn(node, Migration.Mongo, :run, [ self, pool, {}, idx - 1 ])
    end)
  end

  defp monitor_process(processes) do
    receive do
      { :finished, pid, time } when length(processes) > 1 ->
        monitor_process(List.delete(processes, pid))
      { :finished, _pid, time } -> nil
    end
  end
end
{{< /highlight >}}

This code doesn't use OTP functionally, I use `Node.spawn/4` to spawn processes on distributed node. I connect distributed node with `Node.connect/1`. I also created new connection pool with `:resource_pool.new/2`. All PIDs for started processes will be monitored by `monitor_process/1` via standard process message box (issued with `receive`) and recursion. Once all processes are finished I will release connection pool with `:resource_pool.close/1`.

## Overview

I implemented simple distributed application that performs MongoDB migration using multiple processes on distributed nodes. I covered most of the Elixir basics. Full version of this application can be found in [github repository](https://github.com/ap4y/mongo_elixir_helpers).

Ever since I finished [The Art of Readable Code](http://shop.oreilly.com/product/9780596802301.do) I started dislike loops and conditionals in imperative languages. In most cases I preferred early returns or additional abstractions over conditionals and Ruby enumerables. Pattern matching, guard clauses and recursion allowed me to avoid conditionals and loops (Elixir doesn't have loops at all). Immutability guaranties that objects won't change inside function, this makes your code more predictable. I really like reading Elixir codes so far.

I found testing is more enjoyable with Elixir too. Partially because code is just functions without state. State in most cases is stored in tuples or lists, which simplifies state creation.

Actor based concurrence with immutable objects allows me to completely forget about all kind of concurrency issues. Ability to saturate all processor cores really fast is quite useful, and if I need more computation power I can always connect distributed machine. When I want to maximise application uptime I can bring OTP functionality and get process recovery and hot code swapping.

As I mentioned in the beginning it's really important to understand unique features of the programming languages. I want to learn more such unique languages. I still will be using Ruby, I still value and like it a lot. But learning Elixir will grant me ability to solve some task more efficiently or faster.

I bought [Programming Erlang](http://pragprog.com/book/jaerlang/programming-erlang) by Joe Armstrong (author of the Erlang) and I hope to learn more about OTP and Erlang overall. I definitely keen to use Elixir in production whenever it will be beneficial for the product.
