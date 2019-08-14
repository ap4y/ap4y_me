+++
title = "Vim for iOS developers"
date = 2013-11-11
+++

> Vim is a really popular editor for scripting languages, but it can be hard to integrate it with compiled languages like Objective-C. In this article I will describe my Vim workflow for iOS development. 

I would not say that Xcode is a bad editor, I used it for a several years. I simply more productive with Vim. I feel like Vim complements the way my brain works. For example, if I want to move to the third word, to the second occurrence of "f" or change word between quotes, I will just do that in Vim instead of tapping cursor keys. To be honest I still use Xcode for storyboards and occasionally I edit code with a great [XVim](https://github.com/JugglerShu/XVim) plugin. I like XVim, but it is really hard to emulate Vim's behaviour precisely and there is no way to use plugins, which can be quite helpful.

When I tried to switch from Xcode to Vim, I created a list of features that I need to be at least equally productive with Vim:

- Syntax highlighting;
- Code completion;
- Documentation access;
- Compilation and simulator;
- Unit testing;
- Debugging;

I will describe how I was able to solve this tasks and what differences between Vim's and Xcode's workflow I encountered.

## Objective-C Syntax Highlighting and iOS Docsets

The simplest problem that I encounter is the syntax highlighting. Vim has a really powerful highlighting engine, it allows you define syntax definitions. I won't be describing this process in details because it's too trivial. Syntax definitions are just regex rules, plus scope hinters (region, keyword and others). You can find my current version [here](https://github.com/ap4y/dotfiles/blob/master/vim/after/syntax/objc.vim).

Documentation is not a problem too. I actually used [Dash](http://kapeli.com/dash) (which I highly recommend) instead of Xcode's documentation browser since it was quite slow (this is not the case for Xcode 5). I use [dash.vim](https://github.com/rizzatti/dash.vim), which automatically sets search scope to the current language and gives context based search functionality.

## Compilation and Code Completion

After adding syntax definitions I was able to do the editing in Vim, but I missed code completion a bit, so I tried to find lightweight solution for this problem. I knew that Xcode code completion engine is baked by [clang](http://clang.llvm.org/), so I decided to look for `clang` based plugin. I found [clang_complete](https://github.com/Rip-Rip/clang_complete) and was quite impressed. This is a really solid plugin: it's quite fast, lightweight and under active development. Unfortunately, this plugin targeted C++ audience, so I had some problems initially with Objective-C.

Obviously, in order to use any clang based solution I had to find a way to compile iOS project with `llvm` from command line. The obvious problem is linking. If you will take a look into Xcode compilation process you will find how much dependencies Xcode injects into llvm's CLI. Another problem is SDK versions, it changes framework paths and I had to handle that. Initially, this problem looked quite complex, fortunately there was an easy solution.

After some research I found that clang has support for [Compilation Database](http://clang.llvm.org/docs/JSONCompilationDatabase.html), which is basically compilation snapshot described as json document. You can provide this json document to the llvm's CLI and it will extract all dependencies for compilation process. I checked clang_complete supported compilation database and started investigating how I can create it.

Compilation Database creation can be performed in 2 simple steps:

1. Compile your project and save output.
2. Format output into json with such structure:

{{< highlight json >}}
[
  {
    "directory": "some directory",
    "command": "compilation command",
    "file": "file to compile"
  }
]
{{< /highlight >}}

Since I wanted a long lasting solution, I decided to script this process with Ruby.

From my previous experiments I knew about [xcodebuild-rb](https://github.com/lukeredpath/xcodebuild-rb) gem. It provides great DSL for `xcodebuild` utility (part of Xcode). I wrote a simple script for generic project compilation, packed it into `Rake` task with couple commands: `xcode_build` and `clang_db`. Output formatting is quite a simple task with Ruby, I solved this problem in 12 lines of code and embedded it into `clang_db` task. I also created couple handy mappings in `vimrc`:

{{< highlight text >}}
nmap <leader>x :!rake xcode_build<CR>
nmap <leader>cl :!rake clang_db<CR>
{{< /highlight >}}

This allowed me to compile project and create compilation database directly from Vim, compilation database activates clang_complete plugin. After couple hours with this plugin I found 2 surprising features:

- You can jump to declaration with `<CTRL-]>`, it works with frameworks from SDK too.
- You can check syntax with `g:ClangUpdateQuickFix()`, which integrates nicely with quickfix window.

This two features bring Vim workflow really close to the Xcode workflow. By using clang and clang_complete I was be able achieve same level of functionality, plus I got really nice integration with Vim. This functionality works really fast.

## Running Project in Simulator and Unit Testing

With my Rake task I was able to compile my project, next step was to run it with iOS simulator. I already knew a great solution for quite a while from my previous experiments with [Jenkins](http://jenkins-ci.org/).

I knew about private `DTiPhoneSimulatorSession` framework and how I could use it. I also knew about several wrappers and I had experience with [ios-sim](https://github.com/phonegap/ios-sim). It's easy to install with Homebrew and has a nice CLI. So I integrated it into my Rake task.

After integrating iOS simulator into Vim, I proceeded with unit testing, which again wasn't a problem for me. I was a fan of TDD for quite a while, unfortunately unit testing experience with Xcode was always a bit lacklustre (it improved a bit with Xcode 5). I always wanted to get a [Guard](https://github.com/guard/guard) based approach with Xcode, running single test from Xcode was a problem, so I created myself a plugin for Guard [guard-ocunit](https://github.com/ap4y/guard-ocunit).

This 2 relatively simple steps allowed me to bring Vim based workflow really close to the Xcode, I was able to do most of the coding in Vim.

## Debugging

At this point I already did most of the development in Vim, apart from moments when I needed debugging. Initially I didn't think about integrating debugger into Vim, this problem looked quite complex, specifically due to the UI it required. Also I didn't knew if it's even possible to integrate breakpoints into Vim at all. But after the success with clang_complete I decided to take a look into lldb and the way I could integrate it.

I spend some time learning lldb. I noticed that lldb has 2 ways to start: you can use run and attach. Running process from lldb wasn't an option, since iOS app requires simulator as a host process, so I tried to use attach option. CLI for lldb has `-n` option that allows you to attach to the process, so I started process with ios-sim and attached it. Experiment was successful, I tried different things. Results were quite questionable, I was able to do what I wanted, but console interface was hard to use. That was the moment when searching for "vim+lldb" returned quite promising result.

I found a great vim-lldb plugin (by Daniel Malea) inside llvm-project sources ([svn](https://llvm.org/viewvc/llvm-project/lldb/trunk/utils/vim-lldb/), [unofficial git mirror](https://github.com/chapuni/llvm-project/commits/master/lldb/utils/vim-lldb/plugin)). It uses [lldb Python API](http://lldb.llvm.org/python-reference.html) and implements UI via vimscript. Unfortunately, attach command was not a part of the plugin, so I decided to add it. It took me a while to study sources and API documentation, but I was able to produce working solution in a couple hours.

After first run through I was quite impressed. I had information from threads, registers and variables directly in Vim. More importantly I could add breakpoint at any line directly in Vim. I sent a patch with my code to Daniel with a couple questions. After that, I spent couple days with this plugin and noticed that I missed several things and had several ideas that could improve this plugin. Specifically, `p` and `po`, I always used them from console quite a lot. I realised that I can implement context sensitive po in Vim, same way as `dash.vim`. So I implemented a simple bindings `Lprint`, `Lpo` and `LpO` (uses `<cWORD>`). It worked, I could attach to the process and inspect values under cursor with couple keys, instead of switching to the different window and entering full command. I sent couple patches once again and they were merge by now.

## Additional features

At this point I had all necessary functionality in Vim and environment in Vim was more convenient for me. But described functionality is not the only thing that improved my workflow. There are also couple features that I want to mention.

First of all buffers and splits. I tried to use multi window interface in Xcode several times, but it never worked well for me, also it wasn't the fastest feature. On the other hand Vim has a great split and buffer implementation. I can create any required window layout within a couple seconds, switching between buffers (similar to tabs) is fast too. After some time with Vim I started using splits a lot in many different situations. I also use [tmux](http://tmux.sourceforge.net/), which gives even more split options.

Other thing is file navigation. With Xcode I had to use mouse a lot to switch between files. I tried to use "Open Quickly" dialog, but it worked a bit weird (sometimes it showed files from SDK instead of project files). With Vim I use [ctrlp](https://github.com/kien/ctrlp.vim), which is a simple fuzzy search plugin. It works with project files and opened buffers, has integration with git and you can mask unnecessary files from search.

I use git and github a lot, so Vim integration is quite important for me. I use [fugitive](https://github.com/tpope/vim-fugitive). The plugin's official description:

> I'm not going to lie to you; fugitive.vim may very well be the best Git wrapper of all time.

I absolutely agree with this statement. I tried quite a lot git clients (Source Tree, Github for Mac, Xcode integrated client) and fugitive provides more functionality and really simple workflow. It gives me all features that I use on daily basis: add/remove, push, stash, diff, blame, log and many others. All commands are integrated into Vim and have great mappings.

Another important feature is a search within files. While this feature works well in Xcode, there is still a place for improvement, especially if you compare with [The Silver Searcher](https://github.com/ggreer/the_silver_searcher). I use [ag.vim](https://github.com/rking/ag.vim) plugin for quickfix integration. The Silver Searcher is fast, it is really fast. It can traverse complex project within couple milliseconds and it has integration with `.gitignore`, which allows you to mask unnecessary files from search.

Overall, I'm really glad that I spent some time implementing this workflow. It was beneficial for me. I learned more about Vim, llvm, lldb and Xcode. I use different languages throughout the day. Couple days ago I produced Ruby, Elixir, Javascript, HTML, CSS and Objective-C code within one working day. Switching constantly from Vim to Xcode was never easy for me. With simple steps I was able to resolve this problem.

My current Vim config with Rake tasks can be found [here](https://github.com/ap4y/dotfiles).
