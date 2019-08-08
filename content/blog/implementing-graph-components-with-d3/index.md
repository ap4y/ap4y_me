+++
title = "Implementing graph components with D3.js"
date = 2014-06-01
+++

> Declarative approach is the most common way for constructing graphs with D3.js. However, by leveraging features of the Ember.js this approach can be improved in several areas, such as testing, code structure and rendering speed. 

I have been using D3.js for quite a while and always liked it. It's an awesome project, it brought to the community so many powerful and flexible tools, that you can solve wide ranges of tasks: from complex svg construction to the simple `html` generation. However, I always looked for a ways to structure code differently and ways to improve testability of the code. I believe, this 2 problems are quite common, complex [joins](http://bost.ocks.org/mike/join/) can get out of hand pretty fast. Unit testing `svg` generation code was also a problem, mostly because declarative approach resulted in glued view and model layers.

Once I started using Ember.js more, I noticed that computed properties and observers for the complex graph can provide flexible and structured way for refreshing graphs. With a declarative approach, I had to invoke join function on updates or even redraw pieces completely. Also I was thinking that templating with Handlebars can separate view layer and potentially simplify graph construction in conjunction with computed properties. So, I decided to use core mathematical abstractions from D3.js (scales, shape generators, formatters etc.), expose them as a computed properties and use this properties as template bindings. Such approach allows me to have separate model (behavior) layer and view (presentation) layer, it could open a way for easier unit testing too.

## Sample Task

Consider common task to construct `svg` graph that looks like this:

{{< figure src="graph.png" title="" >}}

This is quite a common graph with time domain, although there are several interesting things about it:

- It has a special separator defined by arbitrary time value within defined range, this value stored in `sentAt` variable;
- It has different styles for line and area components, so they have to be generated separately;
- Graph is clipped by `sentAt` separator into 2 pieces to emphasis the values after the separator;
- Last point of the data should be marked with circle;
- It has 2 tooltips: one static at the separator point and another one dynamic from hover event.

Result Ember.js component has to be dynamic, i.e. it has to refresh on input values change. Provided input values are:

- `data`: array of cells in form `[date, value]`;
- `xDomain`: date range to display on graph, `[startDate, endDate]`;
- `sentAt`: date value that defines position of the separator.

## Graph Layout

I'll start with layout, result graph looks like a complex problem, but ultimately it's just a set of smaller problems: axis, lines, areas, separator, clip zones etc. Thus, by starting with layout I will extract this smaller problems and solve them separately.

{{< highlight handlebars >}}
<svg>
  <g {{bind-attr transform='innerGroupTransform'}}>

    <defs>
      <clipPath id="clip-area-before">
        <rect {{bind-attr
                height='innerHeight'
                width='flagPosition'}}></rect>
      </clipPath>
      <clipPath id="clip-area-after">
        <rect {{bind-attr
                x='flagPosition'
                height='innerHeight'
                width='rightClipAreaWidth'}}></rect>
      </clipPath>
    </defs>

    {{graph-axis class="x axis"
      transform=xAxisTransform
      scale=xScale
      tickFormat=xAxisFormat
      ticks=17
      tickSize=12
      tickPadding=3}}

    {{graph-axis class="y axis"
      orient='left'
      ticks=4
      scale=yScale
      tickSize=yTickSize
      tickFormat=yAxisFormat}}

    <path {{bind-attr d='lineData'}}
      class="line before"
      clip-path="url(#clip-area-before)"></path>
    <path {{bind-attr d='lineData'}}
      class="line after"
      clip-path="url(#clip-area-after)"></path>

    <path {{bind-attr d='areaData'}}
      class="area before"
      clip-path="url(#clip-area-before)"></path>
    <path {{bind-attr d='areaData'}}
      class="area after"
      clip-path="url(#clip-area-after)"></path>

    <line class="flag-line" y2='0'
      {{bind-attr
        x2='flagPosition'
        y1='flagLineHeight'
        x1='flagPosition'}}></line>
    <line class="ending-line"
      {{bind-attr
        y1='lastPointY'
        y2='innerHeight'
        x1='lastPointX'
        x2='lastPointX'}}></line>
    <circle class="point" r="4"
      {{bind-attr
        cx='lastPointX'
        cy='lastPointY'}}></circle>
  </g>
</svg>

<div class="response-tooltip" {{bind-attr style='flagTooltipPosition'}}>
  <strong>Sent: </strong>
  <span class="message-sent-time">
    {{moment-format sentAt format='h:mma Do MMMM'}}
  </span>
</div>

{{#if tooltipEventData}}
<div class="response-tooltip opens" {{bind-attr style='tooltipPosition'}}>
  {{tooltipEventData.value}} opens at
  {{moment-format tooltipEventData.date format='h:mma Do MMMM'}}
</div>
{{/if}}
{{< /highlight >}}

This template is quite verbose. I created inner group (`g` tag) to pad inner area a bit. I created 2 `clipPath` tags with `rect` tag inside to define clip areas for the graph. After that I added 2 axis that will be defined as a component, which just wraps axis generator from D3.js. Then I defined 4 `path` tags, 2 for lines and 2 for areas, each of them is declared as clipped by corresponding `clipPath` area. In the end I defined line for the separator and line with circle for the last data point. All declared shapes contain bindings definitions with `bind-attr` for the data parameters (`d`, `x`, `y` etc.).

I moved tooltip definitions outside of the `svg` DOM on the purpose. It's a really frustrating process working with text in `svg`, lack of the simple things like text wrap, makes this process much harder. Back to the tooltips, first tooltip is static (defined with the `flagTooltipPositions`) and second one is hidden behind guard clause, it will be shown with mouse event.

I believe this Handlebars template is easily readable, it's not much different from a regular `html` templates, even if it represents `svg` DOM. One thing to notice, while `bind-attr` works perfectly, it's impossible to use block Handlebars helpers, because they will generate `metamorph` script tags, which are not allowed in `svg` DOM. Hopefully this will be resolved with [HTMLBars](https://github.com/tildeio/htmlbars). Another thing that I noticed is `bind-attr` doesn't work on CSS `class`. After short investigation I figured that it's a `jQuery` problem, `svg` DOM is not fully supported ([ticket](http://bugs.jquery.com/ticket/7584)), so I had to manually generate classes when needed.

## Graph Axis Component

I will continue with `graph-axis` component. As I mentioned this will be just a wrapper around axis generator from D3.js, which means that I won't be creating layout in this case. I found only one such case for the D3.js API so far and believe that such approach is viable in some situations. For example, axis generator has a nice API for refreshing axis, this allows me to creating simple wrapper with observers:

{{< highlight js >}}
App.GraphAxisComponent = Ember.Component.extend({
  tagName:    'g',
  classNames: ['axis'],

  attributeBindings: ['transform'],

  scale:       null,
  orient:      'bottom',
  ticks:       10,
  tickSize:    15,
  tickFormat:  null,
  tickPadding: 15,

  d3Axis: function() {
    return d3.svg.axis()
      .scale(this.get('scale'))
      .orient(this.get('orient'))
      .ticks(this.get('ticks'))
      .tickSize(this.get('tickSize'))
      .tickFormat(this.get('tickFormat'))
      .tickPadding(this.get('tickPadding'));
  }.property('scale', 'orient', 'ticks', 'tickSize',
             'tickFormat', 'tickPadding'),

  didInsertElement: function() {
    this._updateAxis();
  },

  onD3AxisChange: function() {
    if (this.state !== 'inDOM') return;

    this._updateAxis();
  }.observes('d3Axis'),

  _updateAxis: function() {
    d3.select(this.$()[0]).call(this.get('d3Axis'));
  }
});
{{< /highlight >}}

Component will be wrapped in `g` tag and it binds `transform` property of the `svg` element to the variable with the same name. By using scoped `jQuery` selector I accessed generated element and invoked axis generator on it. Notice that generator is wrapped into computed property, which means that it will be cacheable.

## Graph Component Bindings

The only thing left at this point is a bindings definitions for the component layout. I will wrap most common API from the D3.js into computed properties, this allows me to leverage internal caching, activate dynamic behaviour and significantly simplify unit testing bootstrapping process.

{{< highlight js >}}
App.FancyGraphComponent = Ember.Component.extend({

  width:  992,
  height: 300,

  margin: {
    top:    10,
    right:  10,
    bottom: 40,
    left:   40
  },

  didInsertElement: function() {
    this.set('width', this.$().width());
    this.set('height', this.$().height());
  },

  mouseMove: function(e) {
    var bisectX     = d3.bisector(function(d) { return d[0]; }).left,
        time        = this.get('xScale').invert(e.offsetX),
        index       = bisectX(this.get('data'), time, 1),
        tooltipData = this.get('data')[index - 1];

    this.set('tooltipEventData', Ember.Object.create({
      date:  tooltipData[0],
      value: tooltipData[1]
    }));
  },

  innerWidth: function() {
    var margin = this.get('margin');
    return this.get('width') - margin.left - margin.right;
  }.property('width', 'margin'),

  innerHeight: function() {
    var margin = this.get('margin');
    return this.get('height') - margin.top - margin.bottom;
  }.property('height', 'margin'),

  innerGroupTransform: function() {
    var margin = this.get('margin');
    return 'translate(%@, %@)'.fmt(margin.left, margin.top);
  }.property('margin'),

  xAxisTransform: function() {
    return 'translate(0, %@)'.fmt(this.get('innerHeight'));
  }.property('innerHeight'),

  xScale: function() {
    return d3.time.scale()
      .range([0, this.get('innerWidth')])
      .domain(this.get('xDomain'));
  }.property('innerWidth', 'xDomain'),

  yScale: function() {
    var data        = this.get('data'),
        maxValue    = data ? d3.max(data, function(d){ return d[1] }) : 0,
        upperDomain = Math.max(maxValue, 0) + 1;

    return d3.scale.linear()
      .range([this.get('innerHeight'), 0])
      .domain([0, upperDomain]);
  }.property('innerHeight', 'data'),

  d3Line: function() {
    var xScale = this.get('xScale'),
        yScale = this.get('yScale');
    return d3.svg.line()
      .x(function(d) { return xScale(d[0]); })
      .y(function(d) { return yScale(d[1]); })
      .interpolate('monotone');
  }.property('xScale', 'yScale'),

  d3Area: function() {
    var xScale = this.get('xScale'),
        yScale = this.get('yScale');
    return d3.svg.area()
      .x(function(d) { return xScale(d[0]); })
      .y1(function(d) { return yScale(d[1]); })
      .y0(this.get('innerHeight'))
      .interpolate('monotone');
  }.property('xScale', 'yScale'),

  lineData: function() {
    if (!this.get('data')) return 'M0,0';

    return this.get('d3Line')(this.get('data')) || 'M0,0';
  }.property('data', 'd3Line'),

  areaData: function() {
    if (!this.get('data')) return 'M0,0';

    return this.get('d3Area')(this.get('data')) || 'M0,0';
  }.property('data', 'd3Area'),

  xAxisFormat: function() {
    return function(d) { return moment(d).format('ha'); };
  }.property(),

  yAxisFormat: function() {
    return d3.format('f');
  }.property(),

  yTickSize: function() {
    return -this.get('innerWidth');
  }.property('innerWidth'),

  flagPosition: function() {
    return d3.max([this.get('xScale')(this.get('sentAt')), 0]);
  }.property('xScale', 'sentAt'),

  rightClipAreaWidth: function() {
    return this.get('innerWidth') - this.get('flagPosition');
  }.property('innerWidth', 'flagPosition'),

  lastPointX: function() {
    var lastPoint = this.get('data.lastObject');
    if (!lastPoint) return 0;
    return this.get('xScale')(lastPoint[0]);
  }.property('data', 'xScale'),

  lastPointY: function() {
    var lastPoint = this.get('data.lastObject');
    if (!lastPoint) return 0;
    return this.get('yScale')(lastPoint[1]);
  }.property('data', 'yScale'),

  flagLineHeight: function() {
    return this.get('innerHeight') + this.get('margin.top');
  }.property('innerHeight', 'margin'),

  flagTooltipPosition: function() {
    return 'left: %@px; top: -10px'.fmt(this.get('flagPosition'));
  }.property('flagPosition', 'margin'),

  tooltipPosition: function() {
    if (!this.get('tooltipEventData')) return '';

    var tooltipX = this.get('xScale')(this.get('tooltipEventData.date')),
        tooltipY = this.get('yScale')(this.get('tooltipEventData.value'));

    return 'left: %@px; top: %@px'.fmt(tooltipX, tooltipY);
  }.property('tooltipEventData', 'xScale', 'yScale')
});
{{< /highlight >}}

Once again, nothing extraordinary in this code, just a simple data transformations using D3.js API, most of the properties return primitives (strings and numbers). Most interesting part of this code is a mouse event handler. With Ember.js API I didn't have to fallback to D3.js or `jQuery` API for the event listeners. By using such API I used internal run loop, which helps with event throttling. One interesting moment I noticed as a part of the small investigation: D3.js stores data of the shapes generated with joins in `__data__` property, so it can be recovered in Ember.js handler from the target of the event, for example `e.target.__data__`.

In the end I was really satisfied with the result. Firs of all, dynamic behaviour is seamlessly provided by computed properties, so I removed code that specifically handled this situation. Separation into the different layers resulted in more structured code. It also helped a lot with testing, I easily covered all code with unit tests. Additionally, I noticed that code works much faster, I believe partially due to the more optimal implementation and partially due to the cache on the computed properties. Overall, combination of the D3.js and Ember.js worked really well. By using proper API from each library I easily improved previous implementation in a several hours.
