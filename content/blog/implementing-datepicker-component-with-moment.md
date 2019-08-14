+++
title = "Implementing date picker component with Moment.js"
date = 2014-05-26
+++

> There are numerous examples of the date pickers in the internet, but you can find that some of them are really hard to use with Ember.js. Hopefully, it's not hard to roll your own date picker in form of component with proper bindings just using the Moment.js library. 

I have been working on a quite large Ember.js application recently and struggled for some time to find a suitable date picker. While requirements weren't so strict and internet was already full of date pickers, it was really hard to find and integrate available solutions into the system. By reading comments and github issues it looked like I wasn't alone in this search.

As I mentioned before, requirements for the date picker were quite common:

- It has to expose proper API, that allows to integrate with observers;
- It should have customizable appearance;
- It would be perfect if it will be lightweight and without dependencies.

Unfortunately, even with these basic requirements it was hard to find working solution. Especially, external (and unnecessary for the project) dependencies were quite a problem. I have to mention here, that at that point project already relied on the Moment.js, so I didn't consider it as a dependency.

After I tried several solutions and wasn't satisfied with them, I started thinking about implementing date picker myself. Initially, it looked like a tedious task, but I realized really fast that most of the underlying logic can be implemented fast using Moment.js. All that I had to implement is a model layer, sub-component for each calendar date (to encapsulate presentation rules) and glue first 2 pieces in main component.

## Calendar Data Source

I started with a model layer for the future component. I was looking for the proper pattern for this case, and from iOS (Cocoa to be specific) I always liked data construction delegation pattern called `DataSource`, so I decided to construct something similar. As a model I used a date, that will be called `calendar date`, which represents some day with a presented month, it will be used by data source to perform all necessary calculations. Data source will return data required for the component.

{{< highlight js >}}
App.CalendarDataSource = Ember.Object.extend({
  DAYS_IN_WEEK:     7,
  WEEKS_TO_SHOW:    6,
  DAYS_OF_THE_WEEK: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],

  calendarDate: moment(),

  daysOfTheMonth: function() {
    var result       = Ember.A(),
        date         = this.get('calendarDate'),
        iteratorDate = moment(date).startOf('month').startOf('week');

    for (var week = 0; week < this.WEEKS_TO_SHOW; week++) {
      var currentWeek = Ember.A();
      for (var day = 0; day < this.DAYS_IN_WEEK; day++) {
        currentWeek.addObject(moment(iteratorDate));
        iteratorDate.add(1, 'day');
      }
      result.addObject(currentWeek);
    }

    return result;
  }.property('calendarDate'),

  daysOfTheWeek: function() {
    return this.DAYS_OF_THE_WEEK;
  }.property(),

  previousMonth: function() {
    var newDate = moment(this.get('calendarDate')).subtract(1, 'month');
    this.set('calendarDate', newDate);
  },

  nextMonth: function() {
    var newDate = moment(this.get('calendarDate')).add(1, 'month');
    this.set('calendarDate', newDate);
  }
});
{{< /highlight >}}

Result object was quite simple, it has 2 computed properties: `daysOfTheWeek` and `daysOfTheMonth`. First one returns static array of the strings for the component header. Second property returns a 2-dimension array, where each cell represents the day of the presented month, data is aligned to the current `calendarDate`. Data source also has 2 methods to page presented data in both directions. Notice that `daysOfTheMonth` is observing `calendarDate`, so external assignment of the `callendarDate` will trigger required recalculation.

## Calendar Item Component

I wanted each item of the date picker to have different customization options: current date, selected date, previous month etc. These things are quite common for the date pickers, but this view tier logic doesn't belong to the main component. So, I decided to encapsulate this logic in a small component.

{{< highlight js >}}
pp.CalendarItemComponent = Ember.Component.extend({
  tagName: 'td',
  classNameBindings: [
    'isDisabled:disabled-day',
    'isToday:today-day',
    'isSelected:selected-from-date',
    'isNextMonth:next-month',
    'isPreviousMonth:prev-month'
  ],

  isDisabled: function() {
    return this.get('date').isBefore(this.get('fromDate')) ||
      this.get('date').isAfter(this.get('toDate'));
  }.property('data', 'fromDate', 'toDate'),

  isToday: function() {
    return this.get('date').isSame(moment());
  }.property('date'),

  isSelected: function() {
    return this.get('date').isSame(this.get('selectedDate'));
  }.property('date', 'selectedDate'),

  isPreviousMonth: function() {
    return this.get('date').month() < this.get('calendarDate').month();
  }.property('date', 'calendarDate'),

  isNextMonth: function() {
    return this.get('date').month() > this.get('calendarDate').month();
  }.property('date', 'calendarDate'),

  value: function() {
    return this.get('date').date();
  }.property('date'),

  click: function() {
    this.sendAction('pickDateAction', this.get('date'));
  }
});
{{< /highlight >}}

This component is quite simple too, it's just a set of the computed properties that are used as a bindings for component's CSS class names. It also catches a `click` event and propagates it as a `pickDateAction` action. Layout declaration for the component is quite short: `{{value}}`. I just output current day inside defined tag. Notice that component's tag defined as `td`, main component layout will use `html` tables from the markup.


## Date Picker Component

After first 2 elements were finished, I only had to bring them together in main component. Layout first:

{{< highlight handlebars >}}
<h2 class="calendar-month-heading">
  {{moment-format selectedDate format="MMMM YYYY"}}
</h2>
<table class="calendar-month">
  <thead>
    <tr>
      {{#each dOW in dataSource.daysOfTheWeek}}
      <th>{{dOW}}</th>
      {{/each}}
    </tr>
  </thead>
  <tbody>
    {{#each dOM in dataSource.daysOfTheMonth}}
    <tr>
      {{#each date in dOM}}
      {{calendar-item class="calendar-day"
        date=date
        fromDate=fromDate
        toDate=toDate
        selectedDate=selectedDate
        calendarDate=dataSource.calendarDate
        pickDateAction="pickDate"}}
      {{/each}}
    </tr>
    {{/each}}
  </tbody>
</table>
<button {{action 'previousMonth'}}>&laquo</button>
<button {{action 'nextMonth'}}>&raquo</button>

{{< /highlight >}}

In layout I just iterate over the data provided by data source and construct required DOM elements for each item. I also added 2 buttons for the pagination. Next to the bindings and actions definitions:

{{< highlight js >}}
App.DatePickerComponent = Ember.Component.extend({
  fromDate: moment().subtract(1, 'day'),
  toDate:   null,

  onInit: function() {
    this.set('dataSource', App.CalendarDataSource.create());
    this.set('selectedDate', moment().startOf('day'));
  }.on('init'),

  actions: {
    previousMonth: function() {
      this.get('dataSource').previousMonth();
    },

    nextMonth: function() {
      this.get('dataSource').nextMonth();
    },

    pickDate: function(date) {
      this.set('selectedDate', date);
    }
  }
});
{{< /highlight >}}

Main component uses 2 variables `fromDate` and `toDate` to create range of the allowed dates. These variables are also used in `calendar-item` component. Component exposes only 1 value `selectedDate` for the external use, this value is assigned with the `pickDate` action. Minimal use case for the result component:

{{< highlight hanlebars >}}
<div>{{moment-format selectedDate format="D MMM YYYY"}}</div>
{{date-picker selectedDate=selectedDate}}
{{< /highlight >}}

As a result, in a couple hours I was able to implement fully working solution which satisfied all the requirements and was really simple. More importantly, by layering underlying logic properly, I easily covered all code with unit tests. Obviously, finished solution was a bit more complex, but not that far from what presented here.

Small bonus, in examples above I used custom Handlebars helper `moment-format`. It's code is quite simple and presented below:

{{< highlight js >}}
E.H.registerBoundHelper('moment-format', function (date, options) {
  var dateToFormat = date || new Date(),
      format = 'd MMM YYYY';
  if (typeof options.hash.format === 'string') {
    format = options.hash.format
  }
  return moment(dateToFormat).format(format);
});
{{< /highlight >}}
